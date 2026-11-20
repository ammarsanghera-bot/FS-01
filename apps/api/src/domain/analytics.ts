import { Prisma, type CustomerOrderStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decimalString } from "./money.js";

const excluded: CustomerOrderStatus[] = ["CREATED", "AWAITING_PAYMENT", "CANCELLED"];

export function dateRange(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  if (to && to.length === 10) end.setUTCHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function adminOverview(from: Date, to: Date) {
  const orderWhere = { createdAt: { gte: from, lte: to }, status: { notIn: excluded } };
  const [orders, vendorOrders, refunds, customers, vendors, applications, products, series, topProducts, topVendors] = await Promise.all([
    prisma.customerOrder.aggregate({ where: orderWhere, _sum: { grandTotal: true, subtotal: true }, _count: true, _avg: { grandTotal: true } }),
    prisma.vendorOrder.aggregate({
      where: { createdAt: { gte: from, lte: to }, customerOrder: { status: { notIn: excluded } } },
      _sum: { commissionAmount: true, vendorEarnings: true, subtotal: true },
      _count: true,
    }),
    prisma.refund.aggregate({ where: { createdAt: { gte: from, lte: to }, status: "SUCCEEDED" }, _sum: { amount: true }, _count: true }),
    prisma.user.count({ where: { role: "CUSTOMER", status: "ACTIVE", deletedAt: null } }),
    prisma.store.count({ where: { status: "APPROVED" } }),
    prisma.vendorApplication.count({ where: { status: "PENDING" } }),
    prisma.product.count({ where: { status: "PENDING_APPROVAL", deletedAt: null } }),
    salesSeries(prisma, from, to),
    prisma.orderItem.groupBy({
      by: ["productId", "name"],
      where: { customerOrder: orderWhere },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 5,
    }),
    prisma.vendorOrder.groupBy({
      by: ["storeId"],
      where: { createdAt: { gte: from, lte: to }, customerOrder: { status: { notIn: excluded } } },
      _sum: { subtotal: true, commissionAmount: true, vendorEarnings: true },
      _count: true,
      orderBy: { _sum: { subtotal: "desc" } },
      take: 5,
    }),
  ]);
  const stores = await prisma.store.findMany({ where: { id: { in: topVendors.map((row) => row.storeId) } }, select: { id: true, name: true, slug: true } });
  const storeName = new Map(stores.map((store) => [store.id, store]));
  return {
    grossSales: decimalString(orders._sum.subtotal) ?? "0.00",
    gmv: decimalString(orders._sum.grandTotal) ?? "0.00",
    averageOrderValue: decimalString(orders._avg.grandTotal) ?? "0.00",
    orders: orders._count,
    platformRevenue: decimalString(vendorOrders._sum.commissionAmount) ?? "0.00",
    vendorEarnings: decimalString(vendorOrders._sum.vendorEarnings) ?? "0.00",
    refunds: decimalString(refunds._sum.amount) ?? "0.00",
    refundCount: refunds._count,
    activeCustomers: customers,
    activeVendors: vendors,
    pendingApplications: applications,
    pendingProducts: products,
    series: series.map((row) => ({ date: row.day.toISOString().slice(0, 10), revenue: decimalString(row.revenue) ?? "0.00", orders: row.orders })),
    topProducts: topProducts.map((row) => ({ productId: row.productId, name: row.name, quantity: row._sum.quantity ?? 0, revenue: decimalString(row._sum.lineTotal) ?? "0.00" })),
    topVendors: topVendors.map((row) => ({
      store: storeName.get(row.storeId) ?? { id: row.storeId, name: "Store", slug: "" },
      orders: row._count,
      sales: decimalString(row._sum.subtotal) ?? "0.00",
      commission: decimalString(row._sum.commissionAmount) ?? "0.00",
      earnings: decimalString(row._sum.vendorEarnings) ?? "0.00",
    })),
  };
}

export async function vendorOverview(storeId: string, from: Date, to: Date) {
  const where = { storeId, createdAt: { gte: from, lte: to }, customerOrder: { status: { notIn: excluded } } };
  const [orders, pending, products, lowStock, ledger, series, best] = await Promise.all([
    prisma.vendorOrder.aggregate({ where, _sum: { subtotal: true, commissionAmount: true, vendorEarnings: true }, _count: true }),
    prisma.vendorOrder.count({ where: { storeId, status: { in: ["PENDING", "PROCESSING", "PACKED"] }, customerOrder: { status: { notIn: ["CANCELLED", "AWAITING_PAYMENT", "CREATED"] } } } }),
    prisma.product.count({ where: { storeId, deletedAt: null, status: { not: "ARCHIVED" } } }),
    prisma.inventory.findMany({ where: { product: { storeId, deletedAt: null } }, include: { variant: { include: { product: true } } } }),
    prisma.vendorLedger.aggregate({ where: { storeId, createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
    prisma.$queryRaw<{ day: Date; revenue: Prisma.Decimal; orders: number }[]>`
      SELECT date_trunc('day', vo."createdAt") AS day,
             COALESCE(SUM(vo."vendorEarnings"), 0) AS revenue,
             COUNT(*)::int AS orders
      FROM "VendorOrder" vo
      JOIN "CustomerOrder" co ON co.id = vo."customerOrderId"
      WHERE vo."storeId" = ${storeId}
        AND co.status NOT IN ('CREATED', 'AWAITING_PAYMENT', 'CANCELLED')
        AND vo."createdAt" >= ${from} AND vo."createdAt" <= ${to}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.orderItem.groupBy({
      by: ["productId", "name"],
      where: { vendorOrder: where },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
  ]);
  const low = lowStock.filter((row) => row.quantity - row.reserved <= row.lowStockThreshold);
  return {
    sales: decimalString(orders._sum.subtotal) ?? "0.00",
    orders: orders._count,
    pendingOrders: pending,
    products,
    lowStock: low.length,
    commission: decimalString(orders._sum.commissionAmount) ?? "0.00",
    netEarnings: decimalString(orders._sum.vendorEarnings) ?? "0.00",
    ledgerNet: decimalString(ledger._sum.amount) ?? "0.00",
    series: series.map((row) => ({ date: row.day.toISOString().slice(0, 10), revenue: decimalString(row.revenue) ?? "0.00", orders: row.orders })),
    bestSellers: best.map((row) => ({ productId: row.productId, name: row.name, quantity: row._sum.quantity ?? 0, revenue: decimalString(row._sum.lineTotal) ?? "0.00" })),
    lowStockItems: low.slice(0, 6).map((row) => ({
      variantId: row.variantId,
      sku: row.variant.sku,
      product: row.variant.product.name,
      available: Math.max(0, row.quantity - row.reserved),
      threshold: row.lowStockThreshold,
    })),
  };
}

async function salesSeries(db: PrismaClient, from: Date, to: Date) {
  return db.$queryRaw<{ day: Date; revenue: Prisma.Decimal; orders: number }[]>`
    SELECT date_trunc('day', "createdAt") AS day,
           COALESCE(SUM("grandTotal"), 0) AS revenue,
           COUNT(*)::int AS orders
    FROM "CustomerOrder"
    WHERE status NOT IN ('CREATED', 'AWAITING_PAYMENT', 'CANCELLED')
      AND "createdAt" >= ${from} AND "createdAt" <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function salesReport(from: Date, to: Date) {
  const overview = await adminOverview(from, to);
  const categories = await prisma.$queryRaw<{ name: string; revenue: Prisma.Decimal; quantity: number }[]>`
    SELECT c.name AS name, COALESCE(SUM(oi."lineTotal"), 0) AS revenue, COALESCE(SUM(oi.quantity), 0)::int AS quantity
    FROM "OrderItem" oi
    JOIN "CustomerOrder" co ON co.id = oi."customerOrderId"
    JOIN "Product" p ON p.id = oi."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE co.status NOT IN ('CREATED', 'AWAITING_PAYMENT', 'CANCELLED')
      AND co."createdAt" >= ${from} AND co."createdAt" <= ${to}
    GROUP BY c.name
    ORDER BY revenue DESC
  `;
  return {
    ...overview,
    categories: categories.map((row) => ({ name: row.name, revenue: decimalString(row.revenue) ?? "0.00", quantity: row.quantity })),
  };
}
