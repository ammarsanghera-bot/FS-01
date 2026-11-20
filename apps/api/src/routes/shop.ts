import { addressSchema, isShippingMethod, reviewSchema } from "@marketplace/shared";
import { Router } from "express";
import { z } from "zod";
import { addCartItem, addWishlistItem, presentCart, removeCartItem, removeWishlistItem, setCartCoupon, updateCartItem, wishlistFor, getOrCreateCart } from "../domain/cart.js";
import { buildQuote, cancelUnpaidOrder, checkout, confirmPayment, presentQuote } from "../domain/commerce.js";
import { money, presentAddress, productCard, cardInclude } from "../domain/present.js";
import { createReview, presentReview, ratingBreakdown } from "../domain/reviews.js";
import { activeSearchEngine, listProductIds, suggestProducts } from "../domain/search.js";
import { getSettings } from "../domain/settings.js";
import { AppError } from "../lib/errors.js";
import { actor, asyncHandler, ok, pageParams } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { cacheGet, cacheSet, redisStatus } from "../lib/redis.js";
import { requireUser } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimit.js";

export const shopRouter = Router();
const HOME_CACHE_KEY = "catalog:home:v1";

const addressBody = addressSchema.pick({
  fullName: true, line1: true, line2: true, city: true, state: true, postalCode: true, country: true, phone: true,
});

shopRouter.get("/health", asyncHandler(async (_req, res) => {
  let database: "up" | "down" = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }
  const [redis, search] = await Promise.all([redisStatus(), activeSearchEngine()]);
  const okHealth = database === "up";
  res.status(okHealth ? 200 : 503).json({
    success: okHealth,
    message: okHealth ? "OK" : "Degraded",
    data: { database, redis, search, service: "northstar-api" },
    meta: {},
  });
}));

shopRouter.get("/catalog/home", asyncHandler(async (_req, res) => {
  const cached = await cacheGet(HOME_CACHE_KEY);
  if (cached) return ok(res, JSON.parse(cached));
  const settings = await getSettings();
  const visible = { status: "APPROVED" as const, deletedAt: null, store: { status: "APPROVED" as const } };
  const [categories, featured, trending, bestSellers, recommended, deals, vendors] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true, parentId: null }, orderBy: { sortOrder: "asc" } }),
    prisma.product.findMany({ where: { ...visible, isFeatured: true }, include: cardInclude, take: 8, orderBy: { salesCount: "desc" } }),
    prisma.product.findMany({ where: visible, include: cardInclude, take: 8, orderBy: { createdAt: "desc" } }),
    prisma.product.findMany({ where: visible, include: cardInclude, take: 8, orderBy: { salesCount: "desc" } }),
    prisma.product.findMany({ where: { ...visible, ratingCount: { gt: 0 } }, include: cardInclude, take: 8, orderBy: { ratingAvg: "desc" } }),
    prisma.product.findMany({ where: { ...visible, compareAtPrice: { not: null } }, include: cardInclude, take: 8 }),
    prisma.store.findMany({ where: { status: "APPROVED" }, take: 6, orderBy: { ratingCount: "desc" } }),
  ]);
  const data = {
    marketplaceName: settings.marketplace_name,
    announcement: settings.announcement,
    currency: settings.currency,
    banners: settings.homepage_banners,
    categories: categories.map(presentCategory),
    featured: featured.map(productCard),
    trending: trending.map(productCard),
    bestSellers: bestSellers.map(productCard),
    recommended: (recommended.length ? recommended : featured).map(productCard),
    deals: deals.map(productCard),
    vendors: vendors.map(presentStore),
  };
  await cacheSet(HOME_CACHE_KEY, JSON.stringify(data), 60);
  ok(res, data);
}));

shopRouter.get("/categories", asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  ok(res, categories.map(presentCategory));
}));

shopRouter.get("/categories/:slug", asyncHandler(async (req, res) => {
  const category = await prisma.category.findUnique({ where: { slug: String(req.params.slug) } });
  if (!category || !category.isActive) throw new AppError("Category not found", 404);
  ok(res, presentCategory(category));
}));

shopRouter.get("/brands", asyncHandler(async (_req, res) => {
  ok(res, await prisma.brand.findMany({ orderBy: { name: "asc" } }));
}));

shopRouter.get("/products", asyncHandler(async (req, res) => {
  const paging = pageParams(req.query, 12);
  const ids = typeof req.query.ids === "string" && req.query.ids ? req.query.ids.split(",").filter(Boolean) : undefined;
  const filters = {
    q: stringQuery(req.query.q),
    category: stringQuery(req.query.category),
    vendor: stringQuery(req.query.vendor),
    brand: stringQuery(req.query.brand),
    minPrice: numberQuery(req.query.minPrice),
    maxPrice: numberQuery(req.query.maxPrice),
    rating: numberQuery(req.query.rating),
    inStock: req.query.inStock === "true",
    sort: stringQuery(req.query.sort) || (stringQuery(req.query.q) ? "relevance" : "newest"),
    page: ids ? 1 : paging.page,
    pageSize: ids ? Math.min(ids.length, 60) : paging.pageSize,
    ids,
  };
  const listed = await listProductIds(filters);
  const products = listed.ids.length
    ? await prisma.product.findMany({ where: { id: { in: listed.ids } }, include: cardInclude })
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  ok(res, listed.ids.map((id) => byId.get(id)).filter((product): product is NonNullable<typeof product> => Boolean(product)).map(productCard), "OK", {
    page: filters.page,
    pageSize: filters.pageSize,
    total: listed.total,
    pageCount: Math.ceil(listed.total / filters.pageSize),
    engine: listed.engine,
  });
}));

shopRouter.get("/products/:slug", asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { slug: String(req.params.slug), status: "APPROVED", deletedAt: null, store: { status: "APPROVED" } },
    include: {
      ...cardInclude,
      images: { orderBy: { sortOrder: "asc" } },
      attributes: { include: { values: true } },
      variants: { include: { inventory: true }, orderBy: { sku: "asc" } },
      reviews: { where: { status: "APPROVED" }, include: { user: true }, orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!product) throw new AppError("Product not found", 404);
  const [related, breakdown] = await Promise.all([
    prisma.product.findMany({
      where: { categoryId: product.categoryId, id: { not: product.id }, status: "APPROVED", deletedAt: null, store: { status: "APPROVED" } },
      include: cardInclude,
      take: 4,
    }),
    ratingBreakdown(product.id),
  ]);
  ok(res, {
    ...productCard(product),
    description: product.description,
    shortDescription: product.shortDescription,
    sku: product.sku,
    tags: product.tags,
    weightGrams: product.weightGrams,
    dimensions: { lengthCm: product.lengthCm?.toFixed(2) ?? null, widthCm: product.widthCm?.toFixed(2) ?? null, heightCm: product.heightCm?.toFixed(2) ?? null },
    shippingInfo: product.shippingInfo,
    images: product.images.map((image) => ({ url: image.url, alt: image.alt })),
    attributes: product.attributes.map((attribute) => ({ name: attribute.name, values: attribute.values.map((value) => value.value) })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      options: variant.options,
      price: variant.price?.toFixed(2) ?? product.price.toFixed(2),
      compareAtPrice: variant.compareAtPrice?.toFixed(2) ?? product.compareAtPrice?.toFixed(2) ?? null,
      available: Math.max(0, (variant.inventory?.quantity ?? 0) - (variant.inventory?.reserved ?? 0)),
    })),
    vendor: { ...productCard(product).vendor, id: product.store.id, description: undefined },
    reviews: product.reviews.map(presentReview),
    ratingBreakdown: breakdown,
    related: related.map(productCard),
  });
}));

shopRouter.get("/products/:slug/reviews", asyncHandler(async (req, res) => {
  const paging = pageParams(req.query, 10);
  const product = await prisma.product.findUnique({ where: { slug: String(req.params.slug) } });
  if (!product) throw new AppError("Product not found", 404);
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where: { productId: product.id, status: "APPROVED" }, include: { user: true }, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.review.count({ where: { productId: product.id, status: "APPROVED" } }),
  ]);
  ok(res, reviews.map(presentReview), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

shopRouter.get("/search/suggest", asyncHandler(async (req, res) => {
  ok(res, await suggestProducts(String(req.query.q || "")));
}));

shopRouter.get("/stores", asyncHandler(async (_req, res) => {
  const stores = await prisma.store.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" } });
  ok(res, stores.map(presentStore));
}));

shopRouter.get("/stores/:slug", asyncHandler(async (req, res) => {
  const store = await prisma.store.findFirst({ where: { slug: String(req.params.slug), status: "APPROVED" } });
  if (!store) throw new AppError("Store not found", 404);
  const products = await prisma.product.findMany({ where: { storeId: store.id, status: "APPROVED", deletedAt: null }, include: cardInclude, take: 24, orderBy: { createdAt: "desc" } });
  ok(res, { ...presentStore(store), products: products.map(productCard) });
}));

shopRouter.get("/shipping/methods", asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  ok(res, [
    { id: "standard", label: "Standard", detail: "5–7 business days", price: settings.standard_shipping.toFixed(2), freeThreshold: settings.free_shipping_threshold.toFixed(2) },
    { id: "express", label: "Express", detail: "2–3 business days", price: settings.express_shipping.toFixed(2), freeThreshold: null },
  ]);
}));

shopRouter.get("/cart", asyncHandler(async (_req, res) => {
  const cart = await getOrCreateCart({ userId: res.locals.user?.id, sessionId: res.locals.sessionId });
  ok(res, await presentCart(cart, res.locals.user?.id));
}));

shopRouter.post("/cart/items", writeLimiter, asyncHandler(async (req, res) => {
  const input = z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99).default(1) }).parse(req.body);
  ok(res, await addCartItem({ ...identity(res), ...input }), "Added to cart");
}));

shopRouter.patch("/cart/items/:id", asyncHandler(async (req, res) => {
  const { quantity } = z.object({ quantity: z.number().int().min(0).max(99) }).parse(req.body);
  ok(res, await updateCartItem({ ...identity(res), itemId: String(req.params.id), quantity }), "Cart updated");
}));

shopRouter.delete("/cart/items/:id", asyncHandler(async (req, res) => {
  ok(res, await removeCartItem({ ...identity(res), itemId: String(req.params.id) }), "Removed from cart");
}));

shopRouter.put("/cart/coupon", asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().trim().max(40).nullable() }).parse(req.body);
  ok(res, await setCartCoupon({ ...identity(res), couponCode: code }), "Coupon updated");
}));

shopRouter.post("/checkout/quote", requireUser(), asyncHandler(async (req, res) => {
  const input = z.object({ shippingMethod: z.string(), couponCode: z.string().nullable().optional() }).parse(req.body);
  if (!isShippingMethod(input.shippingMethod)) throw new AppError("Choose a shipping method", 422);
  const cart = await getOrCreateCart({ userId: actor(res).id });
  const quote = await buildQuote(prisma, cart.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })), {
    userId: actor(res).id,
    couponCode: input.couponCode ?? cart.couponCode,
    shippingMethod: input.shippingMethod,
  });
  ok(res, presentQuote(quote));
}));

shopRouter.post("/checkout", requireUser(), writeLimiter, asyncHandler(async (req, res) => {
  const input = z.object({
    shippingMethod: z.string(),
    couponCode: z.string().nullable().optional(),
    shippingAddress: addressBody,
    billingAddress: addressBody.optional(),
    notes: z.string().max(500).optional(),
  }).parse(req.body);
  if (!isShippingMethod(input.shippingMethod)) throw new AppError("Choose a shipping method", 422);
  const order = await checkout({
    userId: actor(res).id,
    shippingMethod: input.shippingMethod,
    couponCode: input.couponCode,
    shippingAddress: input.shippingAddress,
    billingAddress: input.billingAddress ?? input.shippingAddress,
    notes: input.notes,
    idempotencyKey: req.header("idempotency-key") || null,
  });
  ok(res, customerOrder(order), "Order placed", {});
}));

shopRouter.post("/payments/:id/confirm", requireUser(), writeLimiter, asyncHandler(async (req, res) => {
  const { outcome } = z.object({ outcome: z.enum(["success", "failure"]).default("success") }).parse(req.body ?? {});
  const order = await confirmPayment({ paymentId: String(req.params.id), actor: actor(res), outcome });
  ok(res, customerOrder(order), outcome === "success" ? "Payment confirmed" : "Payment failed");
}));

shopRouter.get("/orders", requireUser(["CUSTOMER", "ADMIN"]), asyncHandler(async (req, res) => {
  const paging = pageParams(req.query);
  const where = actor(res).role === "ADMIN" ? {} : { userId: actor(res).id };
  const [orders, total] = await Promise.all([
    prisma.customerOrder.findMany({ where, include: orderInclude, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.pageSize }),
    prisma.customerOrder.count({ where }),
  ]);
  ok(res, orders.map(customerOrder), "OK", { page: paging.page, pageSize: paging.pageSize, total });
}));

shopRouter.get("/orders/:orderNumber", requireUser(), asyncHandler(async (req, res) => {
  const order = await prisma.customerOrder.findUnique({ where: { orderNumber: String(req.params.orderNumber) }, include: orderInclude });
  if (!order) throw new AppError("Order not found", 404);
  if (actor(res).role !== "ADMIN" && order.userId !== actor(res).id) throw new AppError("You do not have access to this order", 403);
  ok(res, customerOrder(order));
}));

shopRouter.post("/orders/:orderNumber/cancel", requireUser(), asyncHandler(async (req, res) => {
  const order = await cancelUnpaidOrder({ userId: actor(res).id, role: actor(res).role, orderNumber: String(req.params.orderNumber) });
  ok(res, customerOrder(order), "Order cancelled");
}));

shopRouter.get("/wishlist", asyncHandler(async (_req, res) => {
  ok(res, await wishlistFor(identity(res)));
}));

shopRouter.post("/wishlist", asyncHandler(async (req, res) => {
  const { productId } = z.object({ productId: z.string() }).parse(req.body);
  ok(res, await addWishlistItem({ ...identity(res), productId }), "Saved");
}));

shopRouter.delete("/wishlist/:productId", asyncHandler(async (req, res) => {
  ok(res, await removeWishlistItem({ ...identity(res), productId: String(req.params.productId) }), "Removed");
}));

shopRouter.post("/wishlist/:productId/move-to-cart", asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: String(req.params.productId) }, include: { variants: { include: { inventory: true } } } });
  if (!product) throw new AppError("Product not found", 404);
  const variant = product.variants.find((item) => (item.inventory?.quantity ?? 0) - (item.inventory?.reserved ?? 0) > 0) ?? product.variants[0];
  if (!variant) throw new AppError("This product has no purchasable variant", 409);
  await addCartItem({ ...identity(res), variantId: variant.id, quantity: 1 });
  ok(res, await removeWishlistItem({ ...identity(res), productId: product.id }), "Moved to cart");
}));

shopRouter.post("/reviews", requireUser(["CUSTOMER"]), asyncHandler(async (req, res) => {
  const input = reviewSchema.parse(req.body);
  const review = await createReview(actor(res).id, input);
  ok(res, review, review.status === "APPROVED" ? "Review published" : "Review submitted for moderation");
}));

shopRouter.get("/me/reviews", requireUser(), asyncHandler(async (_req, res) => {
  const reviews = await prisma.review.findMany({ where: { userId: actor(res).id }, include: { product: true }, orderBy: { createdAt: "desc" } });
  ok(res, reviews.map((review) => ({ ...review, product: { id: review.product.id, name: review.product.name, slug: review.product.slug } })));
}));

shopRouter.get("/me/summary", requireUser(["CUSTOMER"]), asyncHandler(async (_req, res) => {
  const userId = actor(res).id;
  const [orders, spend, wishlist] = await Promise.all([
    prisma.customerOrder.count({ where: { userId, status: { notIn: ["CANCELLED", "AWAITING_PAYMENT", "CREATED"] } } }),
    prisma.customerOrder.aggregate({ where: { userId, status: { notIn: ["CANCELLED", "AWAITING_PAYMENT", "CREATED"] } }, _sum: { grandTotal: true } }),
    prisma.wishlistItem.count({ where: { wishlist: { userId } } }),
  ]);
  ok(res, { orders, spending: money(spend._sum.grandTotal) ?? "0.00", wishlist });
}));

shopRouter.get("/addresses", requireUser(), asyncHandler(async (_req, res) => {
  const addresses = await prisma.address.findMany({ where: { userId: actor(res).id }, orderBy: { id: "asc" } });
  ok(res, addresses.map(presentAddress));
}));

shopRouter.post("/addresses", requireUser(), asyncHandler(async (req, res) => {
  const input = addressSchema.parse(req.body);
  if (input.isDefaultShipping) await prisma.address.updateMany({ where: { userId: actor(res).id }, data: { isDefaultShipping: false } });
  if (input.isDefaultBilling) await prisma.address.updateMany({ where: { userId: actor(res).id }, data: { isDefaultBilling: false } });
  const address = await prisma.address.create({ data: { ...input, userId: actor(res).id, line2: input.line2 || null, phone: input.phone || null, label: input.label || null } });
  ok(res, presentAddress(address), "Address saved");
}));

shopRouter.patch("/addresses/:id", requireUser(), asyncHandler(async (req, res) => {
  const input = addressSchema.partial().parse(req.body);
  const existing = await prisma.address.findFirst({ where: { id: String(req.params.id), userId: actor(res).id } });
  if (!existing) throw new AppError("Address not found", 404);
  if (input.isDefaultShipping) await prisma.address.updateMany({ where: { userId: actor(res).id }, data: { isDefaultShipping: false } });
  if (input.isDefaultBilling) await prisma.address.updateMany({ where: { userId: actor(res).id }, data: { isDefaultBilling: false } });
  const address = await prisma.address.update({ where: { id: existing.id }, data: input });
  ok(res, presentAddress(address), "Address updated");
}));

shopRouter.delete("/addresses/:id", requireUser(), asyncHandler(async (req, res) => {
  const existing = await prisma.address.findFirst({ where: { id: String(req.params.id), userId: actor(res).id } });
  if (!existing) throw new AppError("Address not found", 404);
  await prisma.address.delete({ where: { id: existing.id } });
  ok(res, { deleted: true }, "Address removed");
}));

shopRouter.get("/notifications", requireUser(), asyncHandler(async (_req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: actor(res).id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId: actor(res).id, readAt: null } }),
  ]);
  ok(res, items, "OK", { unread });
}));

shopRouter.get("/notifications/unread-count", requireUser(), asyncHandler(async (_req, res) => {
  ok(res, { unread: await prisma.notification.count({ where: { userId: actor(res).id, readAt: null } }) });
}));

shopRouter.post("/notifications/:id/read", requireUser(), asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: String(req.params.id), userId: actor(res).id }, data: { readAt: new Date() } });
  ok(res, { read: true });
}));

shopRouter.post("/notifications/read-all", requireUser(), asyncHandler(async (_req, res) => {
  await prisma.notification.updateMany({ where: { userId: actor(res).id, readAt: null }, data: { readAt: new Date() } });
  ok(res, { read: true });
}));

shopRouter.post("/newsletter", asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  await prisma.newsletterSubscriber.upsert({ where: { email: email.toLowerCase() }, create: { email: email.toLowerCase() }, update: {} });
  ok(res, { subscribed: true }, "You are on the list");
}));

shopRouter.post("/support", asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().min(1).max(80),
    email: z.string().email(),
    topic: z.string().min(1).max(80),
    message: z.string().min(4).max(4000),
  }).parse(req.body);
  const saved = await prisma.supportMessage.create({ data: input });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" } });
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({ userId: admin.id, type: "support.message", title: "New support message", body: `${input.name}: ${input.topic}` })),
    });
  }
  ok(res, { id: saved.id }, "Message received");
}));

function identity(res: import("express").Response) {
  return { userId: res.locals.user?.id as string | undefined, sessionId: res.locals.sessionId as string | null };
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberQuery(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function presentCategory(category: { id: string; name: string; slug: string; description: string; imageUrl: string | null; commissionRate: { toFixed(n: number): string } | null }) {
  return { id: category.id, name: category.name, slug: category.slug, description: category.description, imageUrl: category.imageUrl, commissionRate: category.commissionRate?.toFixed(2) ?? null };
}

function presentStore(store: { id: string; name: string; slug: string; description: string; logoUrl: string | null; coverUrl: string | null; city: string | null; region: string | null; country: string | null; ratingAvg: { toFixed(n: number): string }; ratingCount: number; returnPolicy: string | null; shippingPolicy: string | null }) {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logoUrl: store.logoUrl,
    coverUrl: store.coverUrl,
    location: [store.city, store.region, store.country].filter(Boolean).join(", "),
    ratingAvg: store.ratingAvg.toFixed(2),
    ratingCount: store.ratingCount,
    returnPolicy: store.returnPolicy,
    shippingPolicy: store.shippingPolicy,
  };
}

const orderInclude = {
  payments: true,
  events: { orderBy: { createdAt: "asc" as const } },
  items: true,
  vendorOrders: { include: { store: true, items: true, shipments: true } },
};

type OrderRecord = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: { toFixed(n: number): string };
  discount: { toFixed(n: number): string };
  shipping: { toFixed(n: number): string };
  tax: { toFixed(n: number): string };
  grandTotal: { toFixed(n: number): string };
  shippingMethod: string;
  couponCode: string | null;
  billingAddress: unknown;
  shippingAddress: unknown;
  createdAt: Date;
  payments: { id: string; status: string; provider: string; amount: { toFixed(n: number): string } }[];
  events: { message: string; createdAt: Date }[];
  vendorOrders: {
    id: string;
    orderNumber: string;
    status: string;
    subtotal: { toFixed(n: number): string };
    discount: { toFixed(n: number): string };
    shipping: { toFixed(n: number): string };
    tax: { toFixed(n: number): string };
    store: { name: string; slug: string };
    shipments: { carrier: string; trackingNumber: string; status: string; shippedAt: Date | null; deliveredAt: Date | null }[];
    items: { id: string; name: string; sku: string; options: unknown; quantity: number; unitPrice: { toFixed(n: number): string }; lineTotal: { toFixed(n: number): string }; productId: string }[];
  }[];
};

export function customerOrder(order: OrderRecord) {
  const payment = order.payments.at(-1);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotal: order.subtotal.toFixed(2),
    discount: order.discount.toFixed(2),
    shipping: order.shipping.toFixed(2),
    tax: order.tax.toFixed(2),
    grandTotal: order.grandTotal.toFixed(2),
    shippingMethod: order.shippingMethod,
    couponCode: order.couponCode,
    billingAddress: order.billingAddress,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    payment: payment ? { id: payment.id, status: payment.status, provider: payment.provider, amount: payment.amount.toFixed(2) } : null,
    events: order.events.map((event) => ({ message: event.message, createdAt: event.createdAt })),
    vendorOrders: order.vendorOrders.map((vendorOrder) => ({
      id: vendorOrder.id,
      orderNumber: vendorOrder.orderNumber,
      status: vendorOrder.status,
      store: { name: vendorOrder.store.name, slug: vendorOrder.store.slug },
      subtotal: vendorOrder.subtotal.toFixed(2),
      discount: vendorOrder.discount.toFixed(2),
      shipping: vendorOrder.shipping.toFixed(2),
      tax: vendorOrder.tax.toFixed(2),
      shipments: vendorOrder.shipments,
      items: vendorOrder.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        options: item.options,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
    })),
  };
}
