import { hashPassword } from "../lib/password.js";
import { slugify } from "@marketplace/shared";
import { Router } from "express";
import { z } from "zod";
import { adminOverview, dateRange, salesReport } from "../domain/analytics.js";
import { approveVendor, rejectVendor, setVendorSuspension } from "../domain/accounts.js";
import { createPayout, refundVendorOrder, setPayoutStatus } from "../domain/commerce.js";
import { moderateProduct } from "../domain/products.js";
import { moderateReview } from "../domain/reviews.js";
import { activeSearchEngine, reindexAll } from "../domain/search.js";
import { getSettings, saveSettings, type PlatformSettings } from "../domain/settings.js";
import { audit } from "../lib/activity.js";
import { AppError } from "../lib/errors.js";
import { actor, asyncHandler, ok, pageParams } from "../lib/http.js";
import { newSecretToken } from "../lib/tokens.js";
import { prisma } from "../lib/prisma.js";
import { requireUser } from "../middleware/auth.js";
import { customerOrder } from "./shop.js";

export const adminRouter = Router();
adminRouter.use(requireUser(["ADMIN"]));

adminRouter.get("/overview", asyncHandler(async (req, res) => {
  const range = dateRange(q(req.query.from), q(req.query.to));
  const [overview, recent] = await Promise.all([
    adminOverview(range.start, range.end),
    prisma.customerOrder.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { user: true, payments: true } }),
  ]);
  ok(res, {
    ...overview,
    recentOrders: recent.map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.grandTotal.toFixed(2),
      createdAt: order.createdAt,
      customer: `${order.user.firstName} ${order.user.lastName}`,
    })),
  });
}));

adminRouter.get("/analytics", asyncHandler(async (req, res) => {
  const range = dateRange(q(req.query.from), q(req.query.to));
  ok(res, await adminOverview(range.start, range.end));
}));

adminRouter.get("/reports/sales", asyncHandler(async (req, res) => {
  const range = dateRange(q(req.query.from), q(req.query.to));
  const report = await salesReport(range.start, range.end);
  if (req.query.format === "csv") {
    const lines = ["date,revenue,orders", ...report.series.map((row) => `${row.date},${row.revenue},${row.orders}`)];
    res.setHeader("content-type", "text/csv");
    return res.send(lines.join("\n"));
  }
  ok(res, report);
}));

adminRouter.get("/users", asyncHandler(async (req, res) => {
  const paging = pageParams(req.query);
  const search = q(req.query.q);
  const role = q(req.query.role);
  const where = {
    deletedAt: null,
    ...(role ? { role: role as "CUSTOMER" } : {}),
    ...(search ? { OR: [{ email: { contains: search, mode: "insensitive" as const } }, { firstName: { contains: search, mode: "insensitive" as const } }, { lastName: { contains: search, mode: "insensitive" as const } }] } : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.pageSize, include: { vendorProfile: { include: { store: true } } } }),
    prisma.user.count({ where }),
  ]);
  ok(res, users.map(publicAdminUser), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

adminRouter.patch("/users/:id", asyncHandler(async (req, res) => {
  const input = z.object({ firstName: z.string().min(1).optional(), lastName: z.string().min(1).optional(), role: z.enum(["CUSTOMER", "VENDOR", "ADMIN"]).optional() }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!user || user.deletedAt) throw new AppError("User not found", 404);
  if (input.role && input.role !== "ADMIN" && user.role === "ADMIN") await assertAnotherAdmin(user.id);
  const updated = await prisma.user.update({ where: { id: user.id }, data: input });
  await audit(prisma, { actorId: actor(res).id, action: "user.updated", entity: "User", entityId: user.id });
  ok(res, publicAdminUser(updated), "User updated");
}));

adminRouter.post("/users/:id/suspend", asyncHandler(async (req, res) => {
  if (String(req.params.id) === actor(res).id) throw new AppError("You cannot suspend your own account", 409);
  const user = await prisma.user.update({ where: { id: String(req.params.id) }, data: { status: "SUSPENDED" } });
  await audit(prisma, { actorId: actor(res).id, action: "user.suspended", entity: "User", entityId: user.id });
  ok(res, publicAdminUser(user), "User suspended");
}));

adminRouter.post("/users/:id/activate", asyncHandler(async (req, res) => {
  const user = await prisma.user.update({ where: { id: String(req.params.id) }, data: { status: "ACTIVE", deletedAt: null } });
  await audit(prisma, { actorId: actor(res).id, action: "user.activated", entity: "User", entityId: user.id });
  ok(res, publicAdminUser(user), "User activated");
}));

adminRouter.delete("/users/:id", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!user || user.deletedAt) throw new AppError("User not found", 404);
  if (user.id === actor(res).id) throw new AppError("You cannot delete your own account", 409);
  if (user.role === "ADMIN") await assertAnotherAdmin(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { status: "DELETED", deletedAt: new Date(), email: `deleted+${user.id}@northstar.invalid`, passwordHash: await hashPassword(newSecretToken()) },
  });
  await audit(prisma, { actorId: actor(res).id, action: "user.deleted", entity: "User", entityId: user.id });
  ok(res, { deleted: true }, "User deleted");
}));

adminRouter.get("/vendors", asyncHandler(async (_req, res) => {
  const vendors = await prisma.vendorProfile.findMany({ include: { user: true, store: true }, orderBy: { user: { createdAt: "desc" } } });
  ok(res, vendors.map((vendor) => ({
    id: vendor.id,
    userId: vendor.userId,
    status: vendor.status,
    legalName: vendor.legalName,
    email: vendor.user.email,
    name: `${vendor.user.firstName} ${vendor.user.lastName}`,
    store: vendor.store ? { id: vendor.store.id, name: vendor.store.name, slug: vendor.store.slug, status: vendor.store.status, commissionRate: vendor.store.commissionRate?.toFixed(2) ?? null } : null,
  })));
}));

adminRouter.post("/vendors/:id/approve", asyncHandler(async (req, res) => {
  const profile = await prisma.vendorProfile.findUnique({ where: { id: String(req.params.id) }, include: { user: { include: { vendorApplication: true } } } });
  if (!profile?.user.vendorApplication) throw new AppError("Application not found", 404);
  await approveVendor(profile.user.vendorApplication.id, actor(res).id);
  ok(res, { approved: true }, "Vendor approved");
}));

adminRouter.post("/vendors/:id/reject", asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(2) }).parse(req.body);
  const profile = await prisma.vendorProfile.findUnique({ where: { id: String(req.params.id) }, include: { user: { include: { vendorApplication: true } } } });
  if (!profile?.user.vendorApplication) throw new AppError("Application not found", 404);
  await rejectVendor(profile.user.vendorApplication.id, actor(res).id, reason);
  ok(res, { rejected: true }, "Vendor rejected");
}));

adminRouter.post("/vendors/:id/suspend", asyncHandler(async (req, res) => {
  const profile = await prisma.vendorProfile.findUnique({ where: { id: String(req.params.id) } });
  if (!profile) throw new AppError("Vendor not found", 404);
  await setVendorSuspension(profile.userId, actor(res).id, true);
  ok(res, { suspended: true }, "Vendor suspended");
}));

adminRouter.post("/vendors/:id/activate", asyncHandler(async (req, res) => {
  const profile = await prisma.vendorProfile.findUnique({ where: { id: String(req.params.id) } });
  if (!profile) throw new AppError("Vendor not found", 404);
  await setVendorSuspension(profile.userId, actor(res).id, false);
  ok(res, { activated: true }, "Vendor activated");
}));

adminRouter.patch("/vendors/:id/commission", asyncHandler(async (req, res) => {
  const { commissionRate } = z.object({ commissionRate: z.number().min(0).max(100).nullable() }).parse(req.body);
  const profile = await prisma.vendorProfile.findUnique({ where: { id: String(req.params.id) }, include: { store: true } });
  if (!profile?.store) throw new AppError("Store not found", 404);
  const store = await prisma.store.update({ where: { id: profile.store.id }, data: { commissionRate: commissionRate == null ? null : commissionRate.toFixed(2) } });
  await audit(prisma, { actorId: actor(res).id, action: "vendor.commission", entity: "Store", entityId: store.id, metadata: { commissionRate } });
  ok(res, { commissionRate: store.commissionRate?.toFixed(2) ?? null }, "Commission updated");
}));

adminRouter.get("/applications", asyncHandler(async (req, res) => {
  const status = q(req.query.status);
  const applications = await prisma.vendorApplication.findMany({
    where: status ? { status: status as "PENDING" } : {},
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  ok(res, applications);
}));

adminRouter.get("/products", asyncHandler(async (req, res) => {
  const paging = pageParams(req.query);
  const status = q(req.query.status);
  const search = q(req.query.q);
  const where = {
    deletedAt: null,
    ...(status ? { status: status as "DRAFT" } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { sku: { contains: search, mode: "insensitive" as const } }] } : {}),
  };
  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, include: { store: true, category: true, images: { take: 1 } }, orderBy: { updatedAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.product.count({ where }),
  ]);
  ok(res, products.map((product) => ({ id: product.id, name: product.name, sku: product.sku, status: product.status, price: product.price.toFixed(2), rejectionReason: product.rejectionReason, store: product.store.name, category: product.category.name, image: product.images[0]?.url ?? null })), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

adminRouter.post("/products/:id/approve", asyncHandler(async (req, res) => {
  ok(res, await moderateProduct(String(req.params.id), actor(res).id, "APPROVED"), "Product approved");
}));

adminRouter.post("/products/:id/reject", asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(2) }).parse(req.body);
  ok(res, await moderateProduct(String(req.params.id), actor(res).id, "REJECTED", reason), "Product rejected");
}));

adminRouter.get("/categories", asyncHandler(async (_req, res) => {
  ok(res, await prisma.category.findMany({ orderBy: { sortOrder: "asc" } }));
}));

adminRouter.post("/categories", asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(2), description: z.string().min(2), imageUrl: z.string().optional(), commissionRate: z.number().min(0).max(100).nullable().optional(), sortOrder: z.number().int().optional() }).parse(req.body);
  const category = await prisma.category.create({
    data: { name: input.name, slug: slugify(input.name), description: input.description, imageUrl: input.imageUrl, commissionRate: input.commissionRate == null ? null : input.commissionRate.toFixed(2), sortOrder: input.sortOrder ?? 0 },
  });
  await audit(prisma, { actorId: actor(res).id, action: "category.created", entity: "Category", entityId: category.id });
  ok(res, category, "Category created");
}));

adminRouter.patch("/categories/:id", asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(2).optional(), description: z.string().min(2).optional(), imageUrl: z.string().nullable().optional(), commissionRate: z.number().min(0).max(100).nullable().optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional() }).parse(req.body);
  const category = await prisma.category.update({
    where: { id: String(req.params.id) },
    data: { ...input, commissionRate: input.commissionRate === undefined ? undefined : input.commissionRate == null ? null : input.commissionRate.toFixed(2) },
  });
  ok(res, category, "Category updated");
}));

adminRouter.delete("/categories/:id", asyncHandler(async (req, res) => {
  const count = await prisma.product.count({ where: { categoryId: String(req.params.id), deletedAt: null } });
  if (count > 0) {
    await prisma.category.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    return ok(res, { deactivated: true }, "Category hidden because it still has products");
  }
  await prisma.category.delete({ where: { id: String(req.params.id) } });
  ok(res, { deleted: true }, "Category deleted");
}));

adminRouter.get("/orders", asyncHandler(async (req, res) => {
  const paging = pageParams(req.query);
  const status = q(req.query.status);
  const where = status ? { status: status as "PAID" } : {};
  const [orders, total] = await Promise.all([
    prisma.customerOrder.findMany({ where, include: { user: true, payments: true, vendorOrders: { include: { store: true, items: true, shipments: true } }, events: true, items: true }, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.customerOrder.count({ where }),
  ]);
  ok(res, orders.map((order) => customerOrder(order)), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

adminRouter.get("/orders/:orderNumber", asyncHandler(async (req, res) => {
  const order = await prisma.customerOrder.findUnique({
    where: { orderNumber: String(req.params.orderNumber) },
    include: { user: true, payments: { include: { transactions: true, refunds: true } }, vendorOrders: { include: { store: true, items: true, shipments: true, commissions: true, ledger: true } }, events: true, items: true },
  });
  if (!order) throw new AppError("Order not found", 404);
  ok(res, {
    ...customerOrder(order),
    customer: { id: order.user.id, name: `${order.user.firstName} ${order.user.lastName}`, email: order.user.email },
    commissions: order.vendorOrders.flatMap((vendorOrder) => vendorOrder.commissions.map((commission) => ({ ...commission, rate: commission.rate.toFixed(2), amount: commission.amount.toFixed(2), baseAmount: commission.baseAmount.toFixed(2), vendorOrderNumber: vendorOrder.orderNumber }))),
    ledger: order.vendorOrders.flatMap((vendorOrder) => vendorOrder.ledger.map((entry) => ({ ...entry, amount: entry.amount.toFixed(2), vendorOrderNumber: vendorOrder.orderNumber }))),
    vendorOrders: order.vendorOrders.map((vendorOrder) => ({
      ...customerOrder(order).vendorOrders.find((item) => item.id === vendorOrder.id),
      commission: vendorOrder.commissionAmount.toFixed(2),
      vendorEarnings: vendorOrder.vendorEarnings.toFixed(2),
    })),
  });
}));

adminRouter.get("/payments", asyncHandler(async (_req, res) => {
  const payments = await prisma.payment.findMany({ include: { customerOrder: true }, orderBy: { createdAt: "desc" }, take: 100 });
  ok(res, payments.map((payment) => ({ id: payment.id, status: payment.status, provider: payment.provider, amount: payment.amount.toFixed(2), orderNumber: payment.customerOrder.orderNumber, createdAt: payment.createdAt })));
}));

adminRouter.get("/transactions", asyncHandler(async (_req, res) => {
  const transactions = await prisma.paymentTransaction.findMany({ include: { payment: { include: { customerOrder: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  ok(res, transactions.map((transaction) => ({ id: transaction.id, type: transaction.type, status: transaction.status, amount: transaction.amount.toFixed(2), providerRef: transaction.providerRef, orderNumber: transaction.payment.customerOrder.orderNumber, createdAt: transaction.createdAt })));
}));

adminRouter.get("/commissions", asyncHandler(async (_req, res) => {
  const commissions = await prisma.commission.findMany({ include: { vendorOrder: { include: { store: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  ok(res, commissions.map((commission) => ({ id: commission.id, source: commission.source, rate: commission.rate.toFixed(2), amount: commission.amount.toFixed(2), baseAmount: commission.baseAmount.toFixed(2), store: commission.vendorOrder.store.name, vendorOrderNumber: commission.vendorOrder.orderNumber, createdAt: commission.createdAt })));
}));

adminRouter.get("/payouts", asyncHandler(async (_req, res) => {
  const payouts = await prisma.payout.findMany({ include: { store: true }, orderBy: { createdAt: "desc" } });
  ok(res, payouts.map((payout) => ({ ...payout, amount: payout.amount.toFixed(2), store: payout.store.name })));
}));

adminRouter.post("/payouts", asyncHandler(async (req, res) => {
  const input = z.object({ storeId: z.string(), amount: z.string().optional(), notes: z.string().optional() }).parse(req.body);
  ok(res, await createPayout({ storeId: input.storeId, amount: input.amount, notes: input.notes, actorId: actor(res).id }), "Payout created");
}));

adminRouter.post("/payouts/:id/status", asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(["PROCESSING", "PAID", "FAILED", "CANCELLED"]) }).parse(req.body);
  ok(res, await setPayoutStatus({ payoutId: String(req.params.id), status, actorId: actor(res).id }), "Payout updated");
}));

adminRouter.get("/refunds", asyncHandler(async (_req, res) => {
  const refunds = await prisma.refund.findMany({ include: { customerOrder: true, vendorOrder: { include: { store: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  ok(res, refunds.map((refund) => ({ id: refund.id, amount: refund.amount.toFixed(2), reason: refund.reason, status: refund.status, orderNumber: refund.customerOrder.orderNumber, store: refund.vendorOrder?.store.name ?? null, createdAt: refund.createdAt })));
}));

adminRouter.post("/refunds", asyncHandler(async (req, res) => {
  const input = z.object({ vendorOrderId: z.string(), reason: z.string().min(2), restock: z.boolean().default(true), amount: z.string().optional() }).parse(req.body);
  ok(res, await refundVendorOrder({ ...input, actorId: actor(res).id }), "Refund issued");
}));

adminRouter.get("/coupons", asyncHandler(async (_req, res) => {
  const coupons = await prisma.coupon.findMany({ include: { store: true, _count: { select: { usages: true } } }, orderBy: { createdAt: "desc" } });
  ok(res, coupons.map((coupon) => ({ ...coupon, value: coupon.value.toFixed(2), minOrder: coupon.minOrder?.toFixed(2) ?? null, maxDiscount: coupon.maxDiscount?.toFixed(2) ?? null, store: coupon.store?.name ?? "Marketplace", usages: coupon._count.usages })));
}));

adminRouter.post("/coupons", asyncHandler(async (req, res) => {
  const input = z.object({
    code: z.string().min(3),
    type: z.enum(["FIXED", "PERCENTAGE", "FREE_SHIPPING"]),
    value: z.string(),
    minOrder: z.string().nullable().optional(),
    maxDiscount: z.string().nullable().optional(),
    usageLimit: z.number().int().nullable().optional(),
    perUserLimit: z.number().int().nullable().optional(),
    startsAt: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
    description: z.string().optional(),
    storeId: z.string().nullable().optional(),
  }).parse(req.body);
  const coupon = await prisma.coupon.create({
    data: {
      code: input.code.toUpperCase(),
      type: input.type,
      value: input.value,
      minOrder: input.minOrder || null,
      maxDiscount: input.maxDiscount || null,
      usageLimit: input.usageLimit ?? null,
      perUserLimit: input.perUserLimit ?? null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      description: input.description,
      storeId: input.storeId || null,
    },
  });
  await audit(prisma, { actorId: actor(res).id, action: "coupon.created", entity: "Coupon", entityId: coupon.id });
  ok(res, coupon, "Coupon created");
}));

adminRouter.patch("/coupons/:id", asyncHandler(async (req, res) => {
  const input = z.object({ active: z.boolean().optional(), expiresAt: z.string().nullable().optional() }).parse(req.body);
  const coupon = await prisma.coupon.update({ where: { id: String(req.params.id) }, data: { active: input.active, expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null } });
  ok(res, coupon, "Coupon updated");
}));

adminRouter.get("/reviews", asyncHandler(async (req, res) => {
  const status = q(req.query.status);
  const reviews = await prisma.review.findMany({
    where: status ? { status: status as "PENDING" } : {},
    include: { user: true, product: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  ok(res, reviews.map((review) => ({ id: review.id, rating: review.rating, title: review.title, body: review.body, status: review.status, product: review.product.name, author: `${review.user.firstName} ${review.user.lastName}`, createdAt: review.createdAt })));
}));

adminRouter.post("/reviews/:id/moderate", asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(["APPROVED", "REJECTED"]) }).parse(req.body);
  ok(res, await moderateReview(String(req.params.id), actor(res).id, status), "Review updated");
}));

adminRouter.get("/search", asyncHandler(async (_req, res) => {
  ok(res, { engine: await activeSearchEngine(), elasticsearchConfigured: Boolean(process.env.ELASTICSEARCH_URL) });
}));

adminRouter.post("/search/reindex", asyncHandler(async (_req, res) => {
  ok(res, await reindexAll(), "Index refreshed");
}));

adminRouter.get("/settings", asyncHandler(async (_req, res) => {
  ok(res, await getSettings());
}));

adminRouter.put("/settings", asyncHandler(async (req, res) => {
  const input = req.body as Partial<PlatformSettings>;
  const saved = await saveSettings(input);
  await audit(prisma, { actorId: actor(res).id, action: "settings.updated", entity: "PlatformSetting", metadata: input as Record<string, unknown> });
  ok(res, saved, "Settings saved");
}));

adminRouter.get("/audit", asyncHandler(async (req, res) => {
  const paging = pageParams(req.query);
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.auditLog.count(),
  ]);
  ok(res, logs.map((log) => ({ id: log.id, action: log.action, entity: log.entity, entityId: log.entityId, metadata: log.metadata, createdAt: log.createdAt, actor: log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : "System" })), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

function q(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function publicAdminUser(user: { id: string; email: string; role: string; status: string; firstName: string; lastName: string; createdAt?: Date; vendorProfile?: { status: string } | null }) {
  return { id: user.id, email: user.email, role: user.role, status: user.status, firstName: user.firstName, lastName: user.lastName, createdAt: user.createdAt ?? null, vendorStatus: user.vendorProfile?.status ?? null };
}

async function assertAnotherAdmin(exceptId: string) {
  const remaining = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE", deletedAt: null, id: { not: exceptId } } });
  if (remaining < 1) throw new AppError("The last active admin cannot be removed", 409);
}
