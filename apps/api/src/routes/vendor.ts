import { Router } from "express";
import { z } from "zod";
import { dateRange, vendorOverview } from "../domain/analytics.js";
import { storeBalance, updateVendorFulfillment } from "../domain/commerce.js";
import { adjustInventory } from "../domain/inventory.js";
import { archiveProduct, createProduct, getOwnedProduct, requireStore, submitProduct, updateProduct, type ProductWrite } from "../domain/products.js";
import { respondToReview } from "../domain/reviews.js";
import { AppError } from "../lib/errors.js";
import { actor, asyncHandler, ok, pageParams } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requireUser } from "../middleware/auth.js";

export const vendorRouter = Router();
vendorRouter.use(requireUser(["VENDOR"]));

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  shortDescription: z.string().trim().min(2).max(280),
  description: z.string().trim().min(2).max(8000),
  categoryId: z.string().min(1),
  brandId: z.string().nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  compareAtPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  sku: z.string().trim().min(2).max(40),
  tags: z.array(z.string()).optional(),
  weightGrams: z.number().int().positive().nullable().optional(),
  lengthCm: z.string().nullable().optional(),
  widthCm: z.string().nullable().optional(),
  heightCm: z.string().nullable().optional(),
  shippingInfo: z.string().max(1000).nullable().optional(),
  images: z.array(z.object({ url: z.string().min(8), alt: z.string().optional() })).optional(),
  attributes: z.array(z.object({ name: z.string().min(1), values: z.array(z.string()) })).optional(),
  variants: z.array(z.object({
    id: z.string().optional(),
    sku: z.string().trim().min(2).max(40),
    name: z.string().optional(),
    options: z.record(z.string()).optional(),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    compareAtPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    quantity: z.number().int().min(0),
    lowStockThreshold: z.number().int().min(0).optional(),
  })).min(1),
  submit: z.boolean().optional(),
});

vendorRouter.get("/application", asyncHandler(async (_req, res) => {
  const application = await prisma.vendorApplication.findUnique({ where: { userId: actor(res).id } });
  const profile = await prisma.vendorProfile.findUnique({ where: { userId: actor(res).id }, include: { store: true } });
  ok(res, { application, vendorStatus: profile?.status ?? null, store: profile?.store ? { id: profile.store.id, name: profile.store.name, slug: profile.store.slug, status: profile.store.status } : null });
}));

vendorRouter.get("/overview", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const range = dateRange(stringQuery(req.query.from), stringQuery(req.query.to));
  const [overview, recent, balance] = await Promise.all([
    vendorOverview(store.id, range.start, range.end),
    prisma.vendorOrder.findMany({ where: { storeId: store.id }, include: { customerOrder: { include: { user: true } }, items: true, shipments: true }, orderBy: { createdAt: "desc" }, take: 6 }),
    storeBalance(store.id),
  ]);
  ok(res, { store: { id: store.id, name: store.name, slug: store.slug, status: store.status }, overview, balance, recentOrders: recent.map(presentVendorOrder) });
}));

vendorRouter.get("/analytics", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const range = dateRange(stringQuery(req.query.from), stringQuery(req.query.to));
  ok(res, await vendorOverview(store.id, range.start, range.end));
}));

vendorRouter.get("/products", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const paging = pageParams(req.query);
  const status = stringQuery(req.query.status);
  const where = { storeId: store.id, deletedAt: null, ...(status ? { status: status as "DRAFT" } : {}) };
  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, variants: true }, orderBy: { updatedAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.product.count({ where }),
  ]);
  ok(res, products.map((product) => ({ ...product, price: product.price.toFixed(2), compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null, image: product.images[0]?.url ?? null })), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

vendorRouter.post("/products", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  ok(res, await createProduct(store.id, productSchema.parse(req.body) as ProductWrite, actor(res).id), "Product saved");
}));

vendorRouter.get("/products/:id", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "read");
  ok(res, await getOwnedProduct(String(req.params.id), store.id));
}));

vendorRouter.patch("/products/:id", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  ok(res, await updateProduct(String(req.params.id), store.id, productSchema.parse(req.body) as ProductWrite, actor(res).id), "Product updated");
}));

vendorRouter.delete("/products/:id", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  await archiveProduct(String(req.params.id), store.id);
  ok(res, { archived: true }, "Product archived");
}));

vendorRouter.post("/products/:id/submit", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  ok(res, await submitProduct(String(req.params.id), store.id), "Submitted");
}));

vendorRouter.get("/inventory", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const rows = await prisma.inventory.findMany({
    where: { product: { storeId: store.id, deletedAt: null } },
    include: { variant: { include: { product: true } }, movements: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { variant: { sku: "asc" } },
  });
  ok(res, rows.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    sku: row.variant.sku,
    options: row.variant.options,
    productId: row.productId,
    product: row.variant.product.name,
    quantity: row.quantity,
    reserved: row.reserved,
    available: Math.max(0, row.quantity - row.reserved),
    lowStockThreshold: row.lowStockThreshold,
    movements: row.movements,
  })));
}));

vendorRouter.post("/inventory/:variantId/adjust", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  const input = z.object({ delta: z.number().int(), reason: z.string().trim().min(2).max(200) }).parse(req.body);
  ok(res, await adjustInventory({ variantId: String(req.params.variantId), delta: input.delta, reason: input.reason, actorId: actor(res).id, storeId: store.id }), "Inventory updated");
}));

vendorRouter.get("/orders", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const paging = pageParams(req.query);
  const status = stringQuery(req.query.status);
  const where = { storeId: store.id, ...(status ? { status: status as "PENDING" } : {}) };
  const [orders, total] = await Promise.all([
    prisma.vendorOrder.findMany({ where, include: vendorOrderInclude, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.vendorOrder.count({ where }),
  ]);
  ok(res, orders.map(presentVendorOrder), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

vendorRouter.get("/orders/:id", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const order = await prisma.vendorOrder.findFirst({ where: { id: String(req.params.id), storeId: store.id }, include: vendorOrderInclude });
  if (!order) throw new AppError("Order not found", 404);
  ok(res, presentVendorOrder(order));
}));

vendorRouter.post("/orders/:id/status", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  const input = z.object({
    status: z.enum(["PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"]),
    carrier: z.string().optional(),
    trackingNumber: z.string().optional(),
  }).parse(req.body);
  const updated = await updateVendorFulfillment({ vendorOrderId: String(req.params.id), actor: actor(res), storeId: store.id, ...input });
  ok(res, updated, "Order updated");
}));

vendorRouter.get("/customers", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const orders = await prisma.vendorOrder.findMany({ where: { storeId: store.id }, include: { customerOrder: { include: { user: true } } } });
  const grouped = new Map<string, { name: string; email: string; orders: number; spend: number }>();
  for (const order of orders) {
    const user = order.customerOrder.user;
    const current = grouped.get(user.id) ?? { name: `${user.firstName} ${user.lastName}`, email: user.email, orders: 0, spend: 0 };
    current.orders += 1;
    current.spend += Number(order.subtotal) - Number(order.discount);
    grouped.set(user.id, current);
  }
  ok(res, [...grouped.values()].map((row) => ({ ...row, spend: row.spend.toFixed(2) })));
}));

vendorRouter.get("/coupons", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const coupons = await prisma.coupon.findMany({ where: { storeId: store.id }, include: { _count: { select: { usages: true } } }, orderBy: { createdAt: "desc" } });
  ok(res, coupons.map((coupon) => ({
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value.toFixed(2),
    minOrder: coupon.minOrder?.toFixed(2) ?? null,
    maxDiscount: coupon.maxDiscount?.toFixed(2) ?? null,
    usageLimit: coupon.usageLimit,
    perUserLimit: coupon.perUserLimit,
    active: coupon.active,
    description: coupon.description,
    usages: coupon._count.usages,
    startsAt: coupon.startsAt,
    expiresAt: coupon.expiresAt,
  })));
}));

vendorRouter.post("/coupons", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  const input = couponSchema.parse(req.body);
  const coupon = await prisma.coupon.create({ data: couponData(input, store.id) });
  ok(res, coupon, "Coupon created");
}));

vendorRouter.patch("/coupons/:id", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  const existing = await prisma.coupon.findFirst({ where: { id: String(req.params.id), storeId: store.id } });
  if (!existing) throw new AppError("Coupon not found", 404);
  const input = couponSchema.partial().parse(req.body);
  const coupon = await prisma.coupon.update({
    where: { id: existing.id },
    data: {
      code: input.code?.toUpperCase(),
      type: input.type,
      value: input.value,
      active: input.active,
      description: input.description,
      minOrder: input.minOrder,
      maxDiscount: input.maxDiscount,
      usageLimit: input.usageLimit,
      perUserLimit: input.perUserLimit,
    },
  });
  ok(res, coupon, "Coupon updated");
}));

vendorRouter.get("/reviews", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const reviews = await prisma.review.findMany({ where: { product: { storeId: store.id } }, include: { user: true, product: true }, orderBy: { createdAt: "desc" } });
  ok(res, reviews.map((review) => ({ id: review.id, rating: review.rating, title: review.title, body: review.body, status: review.status, vendorResponse: review.vendorResponse, createdAt: review.createdAt, product: { name: review.product.name, slug: review.product.slug }, author: `${review.user.firstName} ${review.user.lastName.slice(0, 1)}.` })));
}));

vendorRouter.post("/reviews/:id/respond", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  const { response } = z.object({ response: z.string().trim().min(2).max(2000) }).parse(req.body);
  ok(res, await respondToReview(String(req.params.id), store.id, response), "Response saved");
}));

vendorRouter.get("/store", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  ok(res, store);
}));

vendorRouter.patch("/store", asyncHandler(async (req, res) => {
  const store = await requireStore(actor(res).id, "write");
  const input = z.object({
    name: z.string().min(2).max(80).optional(),
    description: z.string().min(10).max(4000).optional(),
    logoUrl: z.string().nullable().optional(),
    coverUrl: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    returnPolicy: z.string().nullable().optional(),
    shippingPolicy: z.string().nullable().optional(),
  }).parse(req.body);
  ok(res, await prisma.store.update({ where: { id: store.id }, data: input }), "Store updated");
}));

vendorRouter.get("/earnings", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const [balance, ledger] = await Promise.all([
    storeBalance(store.id),
    prisma.vendorLedger.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 50, include: { vendorOrder: true } }),
  ]);
  ok(res, { balance, ledger: ledger.map((entry) => ({ ...entry, amount: entry.amount.toFixed(2), orderNumber: entry.vendorOrder?.orderNumber ?? null })) });
}));

vendorRouter.get("/payouts", asyncHandler(async (_req, res) => {
  const store = await requireStore(actor(res).id, "read");
  const payouts = await prisma.payout.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" } });
  ok(res, { balance: await storeBalance(store.id), payouts: payouts.map((payout) => ({ ...payout, amount: payout.amount.toFixed(2) })) });
}));

vendorRouter.get("/profile", asyncHandler(async (_req, res) => {
  const profile = await prisma.vendorProfile.findUnique({ where: { userId: actor(res).id }, include: { user: true, store: true } });
  ok(res, profile);
}));

const vendorOrderInclude = {
  items: true,
  shipments: true,
  store: true,
  customerOrder: { include: { user: true } },
};

function presentVendorOrder(order: {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: { toFixed(n: number): string };
  discount: { toFixed(n: number): string };
  shipping: { toFixed(n: number): string };
  tax: { toFixed(n: number): string };
  commissionAmount: { toFixed(n: number): string };
  vendorEarnings: { toFixed(n: number): string };
  createdAt: Date;
  items: { id: string; name: string; sku: string; options: unknown; quantity: number; unitPrice: { toFixed(n: number): string }; lineTotal: { toFixed(n: number): string } }[];
  shipments: unknown[];
  customerOrder: { orderNumber: string; shippingAddress: unknown; user: { firstName: string; lastName: string; email: string } };
}) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    parentOrderNumber: order.customerOrder.orderNumber,
    status: order.status,
    subtotal: order.subtotal.toFixed(2),
    discount: order.discount.toFixed(2),
    shipping: order.shipping.toFixed(2),
    tax: order.tax.toFixed(2),
    commission: order.commissionAmount.toFixed(2),
    vendorEarnings: order.vendorEarnings.toFixed(2),
    createdAt: order.createdAt,
    customer: { name: `${order.customerOrder.user.firstName} ${order.customerOrder.user.lastName}`, email: order.customerOrder.user.email },
    shippingAddress: order.customerOrder.shippingAddress,
    items: order.items.map((item) => ({ ...item, unitPrice: item.unitPrice.toFixed(2), lineTotal: item.lineTotal.toFixed(2) })),
    shipments: order.shipments,
  };
}

const couponSchema = z.object({
  code: z.string().trim().min(3).max(40),
  type: z.enum(["FIXED", "PERCENTAGE", "FREE_SHIPPING"]),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
  minOrder: z.string().nullable().optional(),
  maxDiscount: z.string().nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  active: z.boolean().optional(),
  description: z.string().max(300).optional(),
});

function couponData(input: z.infer<typeof couponSchema>, storeId: string | null) {
  return {
    code: input.code.toUpperCase(),
    type: input.type,
    value: input.value,
    minOrder: input.minOrder || null,
    maxDiscount: input.maxDiscount || null,
    usageLimit: input.usageLimit ?? null,
    perUserLimit: input.perUserLimit ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    active: input.active ?? true,
    description: input.description || null,
    storeId,
  };
}

function stringQuery(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
