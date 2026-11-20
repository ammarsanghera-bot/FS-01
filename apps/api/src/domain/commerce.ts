import { Prisma, type CustomerOrderStatus, type VendorOrderStatus } from "@prisma/client";
import { audit, notify } from "../lib/activity.js";
import { AppError, QuoteError } from "../lib/errors.js";
import type { OutboundEmail } from "../lib/mailer.js";
import { sendEmails } from "../lib/mailer.js";
import { prisma, type Db } from "../lib/prisma.js";
import { cacheDel } from "../lib/redis.js";
import { makeOrderNumber } from "../lib/tokens.js";
import { commitReservations, releaseReservations, reserveLines, restockLines } from "./inventory.js";
import { centsToString, decimalToCents, dollarsToCents, rateNumber } from "./money.js";
import { getPaymentProvider, type ConfirmResult } from "./payments.js";
import { quoteCart, type CouponSnapshot, type PricingSettings, type Quote, type QuoteLineInput } from "./pricing.js";
import { getSettings } from "./settings.js";

const HOME_CACHE_KEY = "catalog:home:v1";

export type AddressSnapshot = {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
};

export function rollupCustomerStatus(statuses: string[], paymentStatus: string): CustomerOrderStatus {
  const paid = paymentStatus === "SUCCEEDED" || paymentStatus === "PARTIALLY_REFUNDED" || paymentStatus === "REFUNDED";
  if (!paid) {
    if (paymentStatus === "FAILED" || paymentStatus === "CANCELLED") return "CANCELLED";
    return "AWAITING_PAYMENT";
  }
  const refunded = statuses.filter((status) => status === "REFUNDED").length;
  const live = statuses.filter((status) => status !== "REFUNDED" && status !== "CANCELLED");
  if (live.length === 0) return refunded > 0 ? "REFUNDED" : "CANCELLED";
  if (refunded > 0) return "PARTIALLY_REFUNDED";
  if (live.every((status) => status === "DELIVERED")) return "DELIVERED";
  if (live.every((status) => status === "SHIPPED" || status === "DELIVERED")) return "SHIPPED";
  if (live.some((status) => status === "SHIPPED" || status === "DELIVERED")) return "PARTIALLY_SHIPPED";
  if (live.some((status) => status === "PROCESSING" || status === "PACKED")) return "PROCESSING";
  return "PAID";
}

async function pricingSettings(): Promise<PricingSettings> {
  const settings = await getSettings();
  return {
    taxRatePercent: settings.tax_rate,
    freeShippingThresholdCents: dollarsToCents(settings.free_shipping_threshold),
    standardShippingCents: dollarsToCents(settings.standard_shipping),
    expressShippingCents: dollarsToCents(settings.express_shipping),
    defaultCommissionRate: settings.default_commission_rate,
  };
}

export async function loadQuoteLines(db: Db, items: { variantId: string; quantity: number }[]): Promise<QuoteLineInput[]> {
  const variants = await db.productVariant.findMany({
    where: { id: { in: items.map((item) => item.variantId) } },
    include: { inventory: true, product: { include: { store: true, category: true } } },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  return items.map((item) => {
    const variant = byId.get(item.variantId);
    if (!variant || variant.product.deletedAt || variant.product.status !== "APPROVED" || variant.product.store.status !== "APPROVED") {
      throw new QuoteError("A product in your cart is no longer available");
    }
    return {
      variantId: variant.id,
      productId: variant.productId,
      storeId: variant.product.storeId,
      categoryId: variant.product.categoryId,
      storeName: variant.product.store.name,
      name: variant.product.name,
      sku: variant.sku,
      options: (variant.options ?? {}) as Record<string, string>,
      quantity: item.quantity,
      unitPriceCents: decimalToCents(variant.price ?? variant.product.price),
      available: (variant.inventory?.quantity ?? 0) - (variant.inventory?.reserved ?? 0),
      vendorRate: rateNumber(variant.product.store.commissionRate),
      categoryRate: rateNumber(variant.product.category.commissionRate),
    };
  });
}

export async function loadCoupon(db: Db, code: string | null | undefined, userId: string): Promise<CouponSnapshot | null> {
  if (!code?.trim()) return null;
  const coupon = await db.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon) throw new QuoteError("Coupon code was not found");
  const [usageCount, userUsageCount] = await Promise.all([
    db.couponUsage.count({ where: { couponId: coupon.id } }),
    db.couponUsage.count({ where: { couponId: coupon.id, userId } }),
  ]);
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    amountCents: decimalToCents(coupon.value),
    percent: rateNumber(coupon.value) ?? 0,
    minOrderCents: coupon.minOrder == null ? null : decimalToCents(coupon.minOrder),
    maxDiscountCents: coupon.maxDiscount == null ? null : decimalToCents(coupon.maxDiscount),
    storeId: coupon.storeId,
    usageLimit: coupon.usageLimit,
    perUserLimit: coupon.perUserLimit,
    usageCount,
    userUsageCount,
    active: coupon.active,
    startsAt: coupon.startsAt,
    expiresAt: coupon.expiresAt,
  };
}

export async function buildQuote(
  db: Db,
  items: { variantId: string; quantity: number }[],
  input: { userId: string; couponCode?: string | null; shippingMethod: "standard" | "express" },
): Promise<Quote> {
  const [lines, coupon, settings] = await Promise.all([
    loadQuoteLines(db, items),
    loadCoupon(db, input.couponCode, input.userId),
    pricingSettings(),
  ]);
  return quoteCart({ lines, coupon, shippingMethod: input.shippingMethod, settings });
}

export function presentQuote(quote: Quote) {
  return {
    subtotal: centsToString(quote.subtotalCents),
    discount: centsToString(quote.discountCents),
    shipping: centsToString(quote.shippingCents),
    tax: centsToString(quote.taxCents),
    grandTotal: centsToString(quote.grandTotalCents),
    couponCode: quote.couponCode,
    groups: quote.groups.map((group) => ({
      storeId: group.storeId,
      storeName: group.storeName,
      subtotal: centsToString(group.subtotalCents),
      discount: centsToString(group.discountCents),
      shipping: centsToString(group.shippingCents),
      tax: centsToString(group.taxCents),
      commission: centsToString(group.commissionCents),
      vendorEarnings: centsToString(group.vendorEarningsCents),
      lines: group.lines.map((line) => ({
        variantId: line.variantId,
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        options: line.options,
        quantity: line.quantity,
        unitPrice: centsToString(line.unitPriceCents),
        lineTotal: centsToString(line.lineTotalCents),
        discount: centsToString(line.discountCents),
      })),
    })),
  };
}

const orderInclude = {
  user: true,
  items: true,
  payments: true,
  vendorOrders: { include: { store: { include: { vendorProfile: { include: { user: true } } } }, items: true, shipments: true } },
  events: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.CustomerOrderInclude;

export async function checkout(input: {
  userId: string;
  shippingMethod: "standard" | "express";
  couponCode?: string | null;
  shippingAddress: AddressSnapshot;
  billingAddress: AddressSnapshot;
  notes?: string;
  idempotencyKey?: string | null;
}) {
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { customerOrder: true } });
    if (existing) {
      if (existing.customerOrder.userId !== input.userId) throw new AppError("Idempotency key already used", 409);
      return loadOrder(existing.customerOrderId);
    }
  }

  const settings = await getSettings();
  if (settings.require_verified_email) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user?.emailVerifiedAt) throw new AppError("Verify your email before checkout", 403);
  }

  let created: { orderId: string; paymentId: string; emails: OutboundEmail[]; grandTotalCents: number; orderNumber: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({ where: { userId: input.userId }, include: { items: true } });
      if (!cart || cart.items.length === 0) throw new QuoteError("Your cart is empty");
      const quote = await buildQuote(tx, cart.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })), {
        userId: input.userId,
        couponCode: input.couponCode ?? cart.couponCode,
        shippingMethod: input.shippingMethod,
      });
      const order = await tx.customerOrder.create({
        data: {
          orderNumber: makeOrderNumber("NS"),
          userId: input.userId,
          status: "AWAITING_PAYMENT",
          subtotal: centsToString(quote.subtotalCents),
          discount: centsToString(quote.discountCents),
          shipping: centsToString(quote.shippingCents),
          tax: centsToString(quote.taxCents),
          grandTotal: centsToString(quote.grandTotalCents),
          shippingMethod: input.shippingMethod,
          couponId: quote.couponId,
          couponCode: quote.couponCode,
          billingAddress: input.billingAddress as Prisma.InputJsonValue,
          shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
          notes: input.notes || null,
        },
      });
      await reserveLines(
        tx,
        quote.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, name: line.name })),
        order.id,
        input.userId,
      );
      const stores = await tx.store.findMany({
        where: { id: { in: quote.groups.map((group) => group.storeId) } },
        include: { vendorProfile: { include: { user: true } } },
      });
      const storeById = new Map(stores.map((store) => [store.id, store]));
      for (const group of quote.groups) {
        const vendorOrder = await tx.vendorOrder.create({
          data: {
            orderNumber: makeOrderNumber("VS"),
            customerOrderId: order.id,
            storeId: group.storeId,
            status: "PENDING",
            subtotal: centsToString(group.subtotalCents),
            discount: centsToString(group.discountCents),
            shipping: centsToString(group.shippingCents),
            tax: centsToString(group.taxCents),
            commissionAmount: centsToString(group.commissionCents),
            vendorEarnings: centsToString(group.vendorEarningsCents),
          },
        });
        for (const line of group.lines) {
          const item = await tx.orderItem.create({
            data: {
              customerOrderId: order.id,
              vendorOrderId: vendorOrder.id,
              productId: line.productId,
              variantId: line.variantId,
              name: line.name,
              sku: line.sku,
              options: line.options as Prisma.InputJsonValue,
              unitPrice: centsToString(line.unitPriceCents),
              quantity: line.quantity,
              lineTotal: centsToString(line.lineTotalCents),
              discount: centsToString(line.discountCents),
              commissionRate: line.commissionRate.toFixed(2),
              commissionAmount: centsToString(line.commissionCents),
            },
          });
          await tx.commission.create({
            data: {
              vendorOrderId: vendorOrder.id,
              orderItemId: item.id,
              source: line.commissionSource,
              rate: line.commissionRate.toFixed(2),
              baseAmount: centsToString(line.lineTotalCents - line.discountCents),
              amount: centsToString(line.commissionCents),
            },
          });
        }
      }
      if (quote.couponId) {
        await tx.couponUsage.create({ data: { couponId: quote.couponId, userId: input.userId, customerOrderId: order.id } });
      }
      const payment = await tx.payment.create({
        data: {
          customerOrderId: order.id,
          provider: getPaymentProvider().name,
          status: "PENDING",
          amount: centsToString(quote.grandTotalCents),
          currency: "USD",
          idempotencyKey: input.idempotencyKey || null,
        },
      });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
      await tx.orderEvent.create({ data: { customerOrderId: order.id, message: "Order placed. Awaiting payment." } });
      const emails: OutboundEmail[] = [];
      const buyer = await tx.user.findUnique({ where: { id: input.userId } });
      if (buyer) {
        const email = await notify(tx, {
          userId: buyer.id,
          type: "order.placed",
          title: "Order placed",
          body: `Order ${order.orderNumber} is awaiting payment.`,
          data: { orderNumber: order.orderNumber },
          email: { to: buyer.email, subject: `Order ${order.orderNumber} placed`, text: `We received ${order.orderNumber}. Complete payment to send it to the makers.` },
        });
        if (email) emails.push(email);
      }
      for (const group of quote.groups) {
        const store = storeById.get(group.storeId);
        const vendorUser = store?.vendorProfile.user;
        if (!vendorUser) continue;
        const email = await notify(tx, {
          userId: vendorUser.id,
          type: "vendor.order.new",
          title: "New order",
          body: `${order.orderNumber} includes items from ${store.name}. Payment is still pending.`,
          data: { orderNumber: order.orderNumber },
          email: { to: vendorUser.email, subject: `New order for ${store.name}`, text: `Order ${order.orderNumber} includes your products and is awaiting payment.` },
        });
        if (email) emails.push(email);
      }
      return { orderId: order.id, paymentId: payment.id, emails, grandTotalCents: quote.grandTotalCents, orderNumber: order.orderNumber };
    }, { timeout: 20000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.idempotencyKey) {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return loadOrder(existing.customerOrderId);
    }
    throw error;
  }

  const provider = getPaymentProvider();
  const intent = await provider.createIntent({
    amountCents: created.grandTotalCents,
    currency: "usd",
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    idempotencyKey: created.paymentId,
  });
  await prisma.payment.update({ where: { id: created.paymentId }, data: { providerIntentId: intent.providerIntentId } });
  await sendEmails(created.emails);
  return loadOrder(created.orderId);
}

async function loadOrder(id: string) {
  const order = await prisma.customerOrder.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new AppError("Order not found", 404);
  return order;
}

export async function confirmPayment(input: {
  paymentId?: string;
  providerIntentId?: string;
  actor?: { id: string; role: string };
  outcome?: "success" | "failure";
  viaWebhook?: boolean;
  providerResult?: ConfirmResult;
}) {
  const txResult = await prisma.$transaction(async (tx) => {
    const payment = input.paymentId
      ? await tx.payment.findUnique({ where: { id: input.paymentId }, include: { customerOrder: { include: orderInclude } } })
      : await tx.payment.findFirst({ where: { providerIntentId: input.providerIntentId }, include: { customerOrder: { include: orderInclude } } });
    if (!payment) throw new AppError("Payment not found", 404);
    if (!input.viaWebhook) {
      if (!input.actor) throw new AppError("Sign in required", 401);
      if (input.actor.role !== "ADMIN" && payment.customerOrder.userId !== input.actor.id) {
        throw new AppError("You do not have access to this payment", 403);
      }
    }
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
    const locked = await tx.payment.findUnique({ where: { id: payment.id }, include: { customerOrder: { include: orderInclude } } });
    if (!locked) throw new AppError("Payment not found", 404);
    if (locked.status === "SUCCEEDED" || locked.status === "REFUNDED" || locked.status === "PARTIALLY_REFUNDED") {
      return { orderId: locked.customerOrderId, emails: [] as OutboundEmail[], transfers: [] as TransferRequest[] };
    }
    if (locked.status !== "PENDING" && locked.status !== "PROCESSING") {
      throw new AppError("This payment can no longer be confirmed", 409);
    }
    const decision = input.providerResult ?? (await getPaymentProvider().confirm({ providerIntentId: locked.providerIntentId, outcome: input.outcome }));
    const emails: OutboundEmail[] = [];
    if (decision.status === "FAILED") {
      await releaseReservations(tx, stockLines(locked.customerOrder.items), locked.customerOrderId);
      await tx.couponUsage.deleteMany({ where: { customerOrderId: locked.customerOrderId } });
      await tx.vendorOrder.updateMany({ where: { customerOrderId: locked.customerOrderId }, data: { status: "CANCELLED" } });
      await tx.customerOrder.update({ where: { id: locked.customerOrderId }, data: { status: "CANCELLED" } });
      await tx.payment.update({ where: { id: locked.id }, data: { status: "FAILED", failureReason: decision.failureReason ?? "Payment failed" } });
      await tx.paymentTransaction.create({
        data: { paymentId: locked.id, type: "CHARGE", amount: locked.amount, status: "FAILED", providerRef: decision.providerRef, raw: { reason: decision.failureReason ?? null } },
      });
      await tx.orderEvent.create({ data: { customerOrderId: locked.customerOrderId, message: "Payment failed. Reserved stock was released." } });
      const email = await notify(tx, {
        userId: locked.customerOrder.userId,
        type: "payment.failed",
        title: "Payment failed",
        body: `Payment for ${locked.customerOrder.orderNumber} did not go through.`,
        email: { to: locked.customerOrder.user.email, subject: `Payment failed for ${locked.customerOrder.orderNumber}`, text: decision.failureReason || "The payment was declined. You can check out again." },
      });
      if (email) emails.push(email);
      return { orderId: locked.customerOrderId, emails, transfers: [] as TransferRequest[] };
    }

    await commitReservations(tx, stockLines(locked.customerOrder.items), locked.customerOrderId);
    await tx.payment.update({ where: { id: locked.id }, data: { status: "SUCCEEDED", failureReason: null } });
    await tx.paymentTransaction.create({
      data: { paymentId: locked.id, type: "CHARGE", amount: locked.amount, status: "SUCCEEDED", providerRef: decision.providerRef },
    });
    const vendorStatuses = locked.customerOrder.vendorOrders.map((vendorOrder) => vendorOrder.status);
    await tx.customerOrder.update({ where: { id: locked.customerOrderId }, data: { status: rollupCustomerStatus(vendorStatuses, "SUCCEEDED") } });
    const transfers: TransferRequest[] = [];
    for (const vendorOrder of locked.customerOrder.vendorOrders) {
      await tx.vendorLedger.create({
        data: {
          storeId: vendorOrder.storeId,
          vendorOrderId: vendorOrder.id,
          type: "GROSS",
          amount: centsToString(decimalToCents(vendorOrder.subtotal) - decimalToCents(vendorOrder.discount)),
          description: `Merchandise for ${vendorOrder.orderNumber}`,
        },
      });
      if (decimalToCents(vendorOrder.commissionAmount) !== 0) {
        await tx.vendorLedger.create({
          data: {
            storeId: vendorOrder.storeId,
            vendorOrderId: vendorOrder.id,
            type: "COMMISSION",
            amount: centsToString(-decimalToCents(vendorOrder.commissionAmount)),
            description: `Platform commission for ${vendorOrder.orderNumber}`,
          },
        });
      }
      if (decimalToCents(vendorOrder.shipping) !== 0) {
        await tx.vendorLedger.create({
          data: {
            storeId: vendorOrder.storeId,
            vendorOrderId: vendorOrder.id,
            type: "SHIPPING",
            amount: centsToString(decimalToCents(vendorOrder.shipping)),
            description: `Shipping for ${vendorOrder.orderNumber}`,
          },
        });
      }
      const destination = vendorOrder.store.vendorProfile.stripeAccountId;
      if (destination && getPaymentProvider().name === "stripe") {
        transfers.push({
          amountCents: decimalToCents(vendorOrder.vendorEarnings),
          currency: "usd",
          destination,
          orderId: locked.customerOrderId,
          vendorOrderId: vendorOrder.id,
        });
      }
      const vendorUser = vendorOrder.store.vendorProfile.user;
      const email = await notify(tx, {
        userId: vendorUser.id,
        type: "payment.confirmed",
        title: "Order paid",
        body: `${vendorOrder.orderNumber} is paid and ready to fulfill.`,
        email: { to: vendorUser.email, subject: `${vendorOrder.orderNumber} is ready to fulfill`, text: "Payment cleared. You can pack this suborder from your dashboard." },
      });
      if (email) emails.push(email);
    }
    await tx.orderEvent.create({ data: { customerOrderId: locked.customerOrderId, message: "Payment confirmed." } });
    const buyerEmail = await notify(tx, {
      userId: locked.customerOrder.userId,
      type: "payment.confirmed",
      title: "Payment confirmed",
      body: `Payment for ${locked.customerOrder.orderNumber} was received.`,
      email: {
        to: locked.customerOrder.user.email,
        subject: `Payment received for ${locked.customerOrder.orderNumber}`,
        text: "Your payment was confirmed. Each maker will ship their part of the order.",
      },
    });
    if (buyerEmail) emails.push(buyerEmail);
    return { orderId: locked.customerOrderId, emails, transfers };
  }, { timeout: 20000 });

  await cacheDel(HOME_CACHE_KEY);
  await sendEmails(txResult.emails);
  if (txResult.transfers.length) {
    const provider = getPaymentProvider();
    for (const transfer of txResult.transfers) {
      try {
        const providerRef = await provider.transferToVendor(transfer);
        if (providerRef) {
          await prisma.paymentTransaction.create({
            data: {
              paymentId: (await prisma.payment.findFirstOrThrow({ where: { customerOrderId: txResult.orderId } })).id,
              type: "TRANSFER",
              amount: centsToString(transfer.amountCents),
              status: "SUCCEEDED",
              providerRef,
              raw: { vendorOrderId: transfer.vendorOrderId },
            },
          });
        }
      } catch {
        /* Earnings stay on the ledger for a manual payout when a transfer fails. */
      }
    }
  }
  return loadOrder(txResult.orderId);
}

type TransferRequest = { amountCents: number; currency: string; destination: string; orderId: string; vendorOrderId: string };

function stockLines(items: { variantId: string; quantity: number; name: string }[]) {
  return items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, name: item.name }));
}

export async function cancelUnpaidOrder(input: { userId: string; role: string; orderNumber: string }) {
  const emails = await prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({ where: { orderNumber: input.orderNumber }, include: orderInclude });
    if (!order) throw new AppError("Order not found", 404);
    if (input.role !== "ADMIN" && order.userId !== input.userId) throw new AppError("You do not have access to this order", 403);
    const payment = order.payments.find((item) => item.status === "PENDING") ?? order.payments[0];
    if (!payment || payment.status !== "PENDING" || order.status !== "AWAITING_PAYMENT") {
      throw new AppError("Only unpaid orders can be cancelled this way", 409);
    }
    await releaseReservations(tx, stockLines(order.items), order.id);
    await tx.couponUsage.deleteMany({ where: { customerOrderId: order.id } });
    await tx.vendorOrder.updateMany({ where: { customerOrderId: order.id }, data: { status: "CANCELLED" } });
    await tx.customerOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await tx.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } });
    await tx.orderEvent.create({ data: { customerOrderId: order.id, message: "Order cancelled before payment." } });
    const email = await notify(tx, {
      userId: order.userId,
      type: "order.cancelled",
      title: "Order cancelled",
      body: `${order.orderNumber} was cancelled before payment.`,
      email: { to: order.user.email, subject: `${order.orderNumber} cancelled`, text: "The unpaid order was cancelled and reserved stock was released." },
    });
    return email ? [email] : [];
  });
  await sendEmails(emails);
  return prisma.customerOrder.findUniqueOrThrow({ where: { orderNumber: input.orderNumber }, include: orderInclude });
}

const vendorTransitions: Record<string, VendorOrderStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export async function updateVendorFulfillment(input: {
  vendorOrderId: string;
  actor: { id: string; role: string };
  storeId?: string;
  status: VendorOrderStatus;
  carrier?: string;
  trackingNumber?: string;
}) {
  const emails = await prisma.$transaction(async (tx) => {
    const vendorOrder = await tx.vendorOrder.findUnique({
      where: { id: input.vendorOrderId },
      include: { customerOrder: { include: orderInclude }, items: true, store: true },
    });
    if (!vendorOrder) throw new AppError("Vendor order not found", 404);
    if (input.actor.role === "VENDOR" && vendorOrder.storeId !== input.storeId) throw new AppError("You do not have access to this order", 403);
    if (input.actor.role === "CUSTOMER") throw new AppError("You do not have access to this order", 403);
    const allowed = vendorTransitions[vendorOrder.status] ?? [];
    if (!allowed.includes(input.status)) throw new AppError(`Cannot move this suborder from ${vendorOrder.status} to ${input.status}`, 409);
    const outbound: OutboundEmail[] = [];
    if (input.status === "CANCELLED") {
      const payment = vendorOrder.customerOrder.payments.find((item) => item.status === "SUCCEEDED" || item.status === "PARTIALLY_REFUNDED");
      if (!payment) throw new AppError("Unpaid orders must be cancelled by the customer", 409);
      await refundVendorOrderTx(tx, { vendorOrderId: vendorOrder.id, actorId: input.actor.id, reason: "Cancelled by the seller", restock: true, outbound });
      return outbound;
    }
    if (input.status === "SHIPPED") {
      const carrier = input.carrier?.trim();
      const trackingNumber = input.trackingNumber?.trim();
      if (!carrier || !trackingNumber) throw new AppError("Carrier and tracking number are required to ship", 422);
      await tx.shipment.create({
        data: { vendorOrderId: vendorOrder.id, carrier, trackingNumber, status: "SHIPPED", shippedAt: new Date() },
      });
    }
    if (input.status === "DELIVERED") {
      const shipment = await tx.shipment.findFirst({ where: { vendorOrderId: vendorOrder.id }, orderBy: { createdAt: "desc" } });
      if (shipment) {
        await tx.shipment.update({ where: { id: shipment.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      }
    }
    await tx.vendorOrder.update({ where: { id: vendorOrder.id }, data: { status: input.status } });
    const siblings = await tx.vendorOrder.findMany({ where: { customerOrderId: vendorOrder.customerOrderId } });
    const payment = vendorOrder.customerOrder.payments.find((item) => ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(item.status));
    const nextStatus = rollupCustomerStatus(siblings.map((item) => (item.id === vendorOrder.id ? input.status : item.status)), payment?.status ?? "SUCCEEDED");
    await tx.customerOrder.update({ where: { id: vendorOrder.customerOrderId }, data: { status: nextStatus } });
    const label = input.status === "SHIPPED" ? `Shipped via ${input.carrier} (${input.trackingNumber})` : `Suborder marked ${input.status.toLowerCase()}`;
    await tx.orderEvent.create({ data: { customerOrderId: vendorOrder.customerOrderId, vendorOrderId: vendorOrder.id, message: `${vendorOrder.store.name}: ${label}.` } });
    const email = await notify(tx, {
      userId: vendorOrder.customerOrder.userId,
      type: input.status === "DELIVERED" ? "order.delivered" : "order.shipped",
      title: input.status === "DELIVERED" ? "Delivered" : "Order update",
      body: `${vendorOrder.store.name} updated ${vendorOrder.orderNumber} to ${input.status.toLowerCase()}.`,
      email: {
        to: vendorOrder.customerOrder.user.email,
        subject: `${vendorOrder.orderNumber} is ${input.status.toLowerCase()}`,
        text: `${vendorOrder.store.name} marked ${vendorOrder.orderNumber} as ${input.status.toLowerCase()}.`,
      },
    });
    if (email) outbound.push(email);
    return outbound;
  });
  await sendEmails(emails);
  return prisma.vendorOrder.findUniqueOrThrow({
    where: { id: input.vendorOrderId },
    include: { items: true, shipments: true, store: true, customerOrder: true },
  });
}

export async function refundVendorOrder(input: { vendorOrderId: string; actorId: string; reason: string; restock: boolean; amount?: string }) {
  const emails = await prisma.$transaction(async (tx) => {
    const outbound: OutboundEmail[] = [];
    await refundVendorOrderTx(tx, { ...input, outbound });
    return outbound;
  });
  await cacheDel(HOME_CACHE_KEY);
  await sendEmails(emails);
  return prisma.vendorOrder.findUniqueOrThrow({ where: { id: input.vendorOrderId }, include: { refunds: true, customerOrder: true } });
}

async function refundVendorOrderTx(
  tx: Db,
  input: { vendorOrderId: string; actorId: string; reason: string; restock: boolean; amount?: string; outbound: OutboundEmail[] },
) {
  const vendorOrder = await tx.vendorOrder.findUnique({
    where: { id: input.vendorOrderId },
    include: { items: true, customerOrder: { include: { user: true, payments: true, vendorOrders: true } }, refunds: true, store: true },
  });
  if (!vendorOrder) throw new AppError("Vendor order not found", 404);
  if (vendorOrder.status === "REFUNDED" || vendorOrder.status === "CANCELLED") throw new AppError("This suborder cannot be refunded", 409);
  const payment = vendorOrder.customerOrder.payments.find((item) => item.status === "SUCCEEDED" || item.status === "PARTIALLY_REFUNDED");
  if (!payment) throw new AppError("This order has no captured payment", 409);
  const fullCents = vendorCustomerCents(vendorOrder);
  const already = vendorOrder.refunds.filter((refund) => refund.status === "SUCCEEDED").reduce((sum, refund) => sum + decimalToCents(refund.amount), 0);
  const remaining = fullCents - already;
  if (remaining <= 0) throw new AppError("This suborder is already refunded", 409);
  const requested = input.amount ? decimalToCents(input.amount) : remaining;
  if (requested <= 0 || requested > remaining) throw new AppError("Refund amount is outside the remaining balance", 422);
  const providerRefund = await getPaymentProvider().refund({
    providerIntentId: payment.providerIntentId,
    amountCents: requested,
    idempotencyKey: `refund_${vendorOrder.id}_${already + requested}`,
  });
  const isFull = requested === remaining;
  const merchandiseAndShipping = decimalToCents(vendorOrder.subtotal) - decimalToCents(vendorOrder.discount) + decimalToCents(vendorOrder.shipping);
  const commission = decimalToCents(vendorOrder.commissionAmount);
  const clawback = isFull ? merchandiseAndShipping : Math.round((merchandiseAndShipping * requested) / fullCents);
  const reversal = isFull ? commission : Math.round((commission * requested) / fullCents);
  await tx.refund.create({
    data: {
      paymentId: payment.id,
      customerOrderId: vendorOrder.customerOrderId,
      vendorOrderId: vendorOrder.id,
      amount: centsToString(requested),
      reason: input.reason,
      status: "SUCCEEDED",
      providerRefundId: providerRefund.providerRefundId,
      restock: input.restock && isFull,
    },
  });
  await tx.paymentTransaction.create({
    data: { paymentId: payment.id, type: "REFUND", amount: centsToString(requested), status: "SUCCEEDED", providerRef: providerRefund.providerRefundId },
  });
  if (clawback !== 0) {
    await tx.vendorLedger.create({
      data: { storeId: vendorOrder.storeId, vendorOrderId: vendorOrder.id, type: "REFUND", amount: centsToString(-clawback), description: `Refund for ${vendorOrder.orderNumber}` },
    });
  }
  if (reversal !== 0) {
    await tx.vendorLedger.create({
      data: { storeId: vendorOrder.storeId, vendorOrderId: vendorOrder.id, type: "COMMISSION_REVERSAL", amount: centsToString(reversal), description: `Commission reversed for ${vendorOrder.orderNumber}` },
    });
  }
  if (input.restock && isFull) {
    await restockLines(tx, stockLines(vendorOrder.items), vendorOrder.customerOrderId);
  }
  if (isFull) await tx.vendorOrder.update({ where: { id: vendorOrder.id }, data: { status: "REFUNDED" } });
  const siblings = await tx.vendorOrder.findMany({ where: { customerOrderId: vendorOrder.customerOrderId } });
  const statuses = siblings.map((item) => (item.id === vendorOrder.id && isFull ? "REFUNDED" : item.status));
  const parentStatus = statuses.every((status) => status === "REFUNDED") ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx.customerOrder.update({ where: { id: vendorOrder.customerOrderId }, data: { status: parentStatus } });
  const refundedTotal = (await tx.refund.aggregate({ where: { paymentId: payment.id, status: "SUCCEEDED" }, _sum: { amount: true } }))._sum.amount;
  const paymentStatus = refundedTotal && decimalToCents(refundedTotal) >= decimalToCents(payment.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx.payment.update({ where: { id: payment.id }, data: { status: paymentStatus } });
  await tx.orderEvent.create({
    data: { customerOrderId: vendorOrder.customerOrderId, vendorOrderId: vendorOrder.id, message: `${vendorOrder.store.name} refunded ${centsToString(requested)}.` },
  });
  await audit(tx, { actorId: input.actorId, action: "refund.created", entity: "VendorOrder", entityId: vendorOrder.id, metadata: { amount: centsToString(requested), reason: input.reason } });
  const email = await notify(tx, {
    userId: vendorOrder.customerOrder.userId,
    type: "order.refunded",
    title: "Refund issued",
    body: `${centsToString(requested)} was refunded for ${vendorOrder.customerOrder.orderNumber}.`,
    email: {
      to: vendorOrder.customerOrder.user.email,
      subject: `Refund for ${vendorOrder.customerOrder.orderNumber}`,
      text: `A refund of $${centsToString(requested)} was issued. ${input.reason}`,
    },
  });
  if (email) input.outbound.push(email);
}

function vendorCustomerCents(order: { subtotal: Prisma.Decimal; discount: Prisma.Decimal; shipping: Prisma.Decimal; tax: Prisma.Decimal }) {
  return decimalToCents(order.subtotal) - decimalToCents(order.discount) + decimalToCents(order.shipping) + decimalToCents(order.tax);
}

export async function storeBalance(storeId: string) {
  const ledger = await prisma.vendorLedger.aggregate({ where: { storeId }, _sum: { amount: true } });
  const reserved = await prisma.payout.aggregate({ where: { storeId, status: { in: ["PENDING", "PROCESSING"] } }, _sum: { amount: true } });
  const ledgerCents = ledger._sum.amount ? decimalToCents(ledger._sum.amount) : 0;
  const reservedCents = reserved._sum.amount ? decimalToCents(reserved._sum.amount) : 0;
  return {
    ledger: centsToString(ledgerCents),
    reserved: centsToString(reservedCents),
    available: centsToString(ledgerCents - reservedCents),
    availableCents: ledgerCents - reservedCents,
  };
}

export async function createPayout(input: { storeId: string; amount?: string; actorId: string; notes?: string }) {
  const balance = await storeBalance(input.storeId);
  const amountCents = input.amount ? decimalToCents(input.amount) : balance.availableCents;
  if (amountCents <= 0) throw new AppError("There is no balance to pay out", 409);
  if (amountCents > balance.availableCents) throw new AppError("Amount is higher than the available balance", 409);
  const payout = await prisma.payout.create({
    data: {
      storeId: input.storeId,
      amount: centsToString(amountCents),
      status: "PENDING",
      provider: getPaymentProvider().name === "stripe" ? "stripe" : "mock",
      notes: input.notes || null,
    },
  });
  await audit(prisma, { actorId: input.actorId, action: "payout.created", entity: "Payout", entityId: payout.id, metadata: { amount: payout.amount.toFixed(2) } });
  return payout;
}

export async function setPayoutStatus(input: { payoutId: string; status: "PROCESSING" | "PAID" | "FAILED" | "CANCELLED"; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: input.payoutId }, include: { store: { include: { vendorProfile: { include: { user: true } } } } } });
    if (!payout) throw new AppError("Payout not found", 404);
    if (payout.status === "PAID") throw new AppError("Paid payouts cannot be changed", 409);
    if (input.status === "PAID") {
      await tx.vendorLedger.create({
        data: {
          storeId: payout.storeId,
          payoutId: payout.id,
          type: "PAYOUT",
          amount: centsToString(-decimalToCents(payout.amount)),
          description: `Payout ${payout.id}`,
        },
      });
      await tx.payout.update({
        where: { id: payout.id },
        data: { status: "PAID", providerPayoutId: payout.provider === "mock" ? `mock_po_${payout.id}` : payout.providerPayoutId },
      });
    } else {
      await tx.payout.update({ where: { id: payout.id }, data: { status: input.status } });
    }
    await audit(tx, { actorId: input.actorId, action: "payout.updated", entity: "Payout", entityId: payout.id, metadata: { status: input.status } });
    await notify(tx, {
      userId: payout.store.vendorProfile.userId,
      type: "payout.updated",
      title: "Payout updated",
      body: `A payout of ${payout.amount.toFixed(2)} is now ${input.status.toLowerCase()}.`,
      email: {
        to: payout.store.vendorProfile.user.email,
        subject: `Payout ${input.status.toLowerCase()}`,
        text: `Your payout of $${payout.amount.toFixed(2)} is now ${input.status.toLowerCase()}.`,
      },
    });
    return tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
  });
}

export async function handlePaymentWebhook(raw: Buffer, signature: string | undefined) {
  const provider = getPaymentProvider();
  const valid = provider.verifyWebhook(raw, signature);
  if (!valid) throw new AppError("Invalid webhook signature", 400);
  let event: { id?: string; type?: string; data?: { object?: { id?: string } } };
  try {
    event = JSON.parse(raw.toString("utf8")) as typeof event;
  } catch {
    throw new AppError("Invalid webhook payload", 400);
  }
  if (!event.id || !event.type) throw new AppError("Webhook event is missing an id", 400);
  try {
    await prisma.paymentWebhookEvent.create({
      data: { provider: provider.name, eventId: event.id, payload: event as Prisma.InputJsonValue, signatureValid: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { duplicate: true };
    }
    throw error;
  }
  const intentId = event.data?.object?.id;
  if (intentId && (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed")) {
    await confirmPayment({
      providerIntentId: intentId,
      viaWebhook: true,
      providerResult: event.type === "payment_intent.succeeded"
        ? { status: "SUCCEEDED", providerRef: intentId }
        : { status: "FAILED", providerRef: intentId, failureReason: "The payment failed" },
    });
  }
  await prisma.paymentWebhookEvent.updateMany({ where: { provider: provider.name, eventId: event.id }, data: { processedAt: new Date() } });
  return { duplicate: false };
}

export { orderInclude };
