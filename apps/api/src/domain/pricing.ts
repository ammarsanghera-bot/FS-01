import { QuoteError } from "../lib/errors.js";
import { centsToString, percentOfCents } from "./money.js";

export type QuoteLineInput = {
  variantId: string;
  productId: string;
  storeId: string;
  categoryId: string;
  storeName: string;
  name: string;
  sku: string;
  options: Record<string, string>;
  quantity: number;
  unitPriceCents: number;
  available: number;
  vendorRate: number | null;
  categoryRate: number | null;
};

export type CouponSnapshot = {
  id: string;
  code: string;
  type: "FIXED" | "PERCENTAGE" | "FREE_SHIPPING";
  amountCents: number;
  percent: number;
  minOrderCents: number | null;
  maxDiscountCents: number | null;
  storeId: string | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usageCount: number;
  userUsageCount: number;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
};

export type PricingSettings = {
  taxRatePercent: number;
  freeShippingThresholdCents: number;
  standardShippingCents: number;
  expressShippingCents: number;
  defaultCommissionRate: number;
};

export type PricedLine = QuoteLineInput & {
  lineTotalCents: number;
  discountCents: number;
  commissionRate: number;
  commissionSource: "GLOBAL" | "VENDOR" | "CATEGORY";
  commissionCents: number;
};

export type PricedGroup = {
  storeId: string;
  storeName: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  commissionCents: number;
  vendorEarningsCents: number;
  lines: PricedLine[];
};

export type Quote = {
  lines: PricedLine[];
  groups: PricedGroup[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  grandTotalCents: number;
  couponId: string | null;
  couponCode: string | null;
};

export function allocateCents(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (total === 0) return weights.map(() => 0);
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    const shares = weights.map(() => base);
    let remainder = total - base * weights.length;
    let index = 0;
    while (remainder > 0) {
      shares[index % shares.length] += 1;
      remainder -= 1;
      index += 1;
    }
    return shares;
  }
  const shares: number[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    if (index === weights.length - 1) {
      shares.push(total - allocated);
    } else {
      const share = Math.floor((total * weights[index]) / sum);
      shares.push(share);
      allocated += share;
    }
  }
  return shares;
}

export function quoteCart(input: {
  lines: QuoteLineInput[];
  coupon: CouponSnapshot | null;
  shippingMethod: "standard" | "express";
  settings: PricingSettings;
  now?: Date;
}): Quote {
  const now = input.now ?? new Date();
  if (input.lines.length === 0) throw new QuoteError("Your cart is empty");

  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
      throw new QuoteError(`Quantity for ${line.name} must be between 1 and 99`);
    }
    if (line.unitPriceCents < 0) throw new QuoteError(`Price for ${line.name} is invalid`);
    if (line.available < line.quantity) {
      throw new QuoteError(
        line.available <= 0 ? `${line.name} is out of stock` : `Only ${line.available} of ${line.name} are available`,
        409,
      );
    }
  }

  const lineTotals = input.lines.map((line) => line.unitPriceCents * line.quantity);
  const subtotalCents = lineTotals.reduce((sum, value) => sum + value, 0);
  const coupon = input.coupon;
  const eligible = coupon?.storeId
    ? input.lines.map((line, index) => (line.storeId === coupon.storeId ? index : -1)).filter((index) => index >= 0)
    : input.lines.map((_, index) => index);

  let freeShipping = false;
  const discounts = input.lines.map(() => 0);
  if (coupon) {
    assertCoupon(coupon, eligible, lineTotals, now);
    if (coupon.type === "FREE_SHIPPING") {
      freeShipping = true;
    } else {
      const eligibleSubtotal = eligible.reduce((sum, index) => sum + lineTotals[index], 0);
      let discountTotal = coupon.type === "PERCENTAGE" ? percentOfCents(eligibleSubtotal, coupon.percent) : coupon.amountCents;
      if (coupon.type === "PERCENTAGE" && coupon.maxDiscountCents != null) {
        discountTotal = Math.min(discountTotal, coupon.maxDiscountCents);
      }
      discountTotal = Math.max(0, Math.min(discountTotal, eligibleSubtotal));
      const shares = allocateCents(discountTotal, eligible.map((index) => lineTotals[index]));
      eligible.forEach((lineIndex, shareIndex) => {
        discounts[lineIndex] = shares[shareIndex] ?? 0;
      });
    }
  }

  const discountCents = discounts.reduce((sum, value) => sum + value, 0);
  const merchandiseCents = subtotalCents - discountCents;
  let shippingCents = 0;
  if (!freeShipping) {
    if (input.shippingMethod === "express") shippingCents = input.settings.expressShippingCents;
    else if (merchandiseCents >= input.settings.freeShippingThresholdCents) shippingCents = 0;
    else shippingCents = input.settings.standardShippingCents;
  }
  const taxCents = percentOfCents(merchandiseCents, input.settings.taxRatePercent);

  const lines: PricedLine[] = input.lines.map((line, index) => {
    const rate = resolveCommission(line, input.settings.defaultCommissionRate);
    const base = lineTotals[index] - discounts[index];
    return {
      ...line,
      lineTotalCents: lineTotals[index],
      discountCents: discounts[index],
      commissionRate: rate.rate,
      commissionSource: rate.source,
      commissionCents: percentOfCents(base, rate.rate),
    };
  });

  const byStore = new Map<string, PricedLine[]>();
  for (const line of lines) {
    const group = byStore.get(line.storeId) ?? [];
    group.push(line);
    byStore.set(line.storeId, group);
  }
  const drafts = [...byStore.entries()].map(([storeId, groupLines]) => ({
    storeId,
    storeName: groupLines[0].storeName,
    subtotalCents: groupLines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    discountCents: groupLines.reduce((sum, line) => sum + line.discountCents, 0),
    commissionCents: groupLines.reduce((sum, line) => sum + line.commissionCents, 0),
    lines: groupLines,
  }));
  const weights = drafts.map((group) => group.subtotalCents - group.discountCents);
  const shippingShares = allocateCents(shippingCents, weights);
  const taxShares = allocateCents(taxCents, weights);
  const groups: PricedGroup[] = drafts.map((group, index) => ({
    ...group,
    shippingCents: shippingShares[index] ?? 0,
    taxCents: taxShares[index] ?? 0,
    vendorEarningsCents: group.subtotalCents - group.discountCents - group.commissionCents + (shippingShares[index] ?? 0),
  }));

  return {
    lines,
    groups,
    subtotalCents,
    discountCents,
    shippingCents,
    taxCents,
    grandTotalCents: merchandiseCents + shippingCents + taxCents,
    couponId: coupon?.id ?? null,
    couponCode: coupon?.code ?? null,
  };
}

function resolveCommission(line: QuoteLineInput, fallback: number): { rate: number; source: PricedLine["commissionSource"] } {
  if (line.vendorRate != null) return { rate: clampRate(line.vendorRate), source: "VENDOR" };
  if (line.categoryRate != null) return { rate: clampRate(line.categoryRate), source: "CATEGORY" };
  return { rate: clampRate(fallback), source: "GLOBAL" };
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.min(rate, 100);
}

function assertCoupon(coupon: CouponSnapshot, eligible: number[], lineTotals: number[], now: Date): void {
  if (!coupon.active) throw new QuoteError("This coupon is not active");
  if (coupon.startsAt && coupon.startsAt > now) throw new QuoteError("This coupon is not active yet");
  if (coupon.expiresAt && coupon.expiresAt < now) throw new QuoteError("This coupon has expired");
  if (eligible.length === 0) throw new QuoteError("This coupon does not apply to the items in your cart");
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    throw new QuoteError("This coupon has reached its usage limit");
  }
  if (coupon.perUserLimit != null && coupon.userUsageCount >= coupon.perUserLimit) {
    throw new QuoteError("You have already used this coupon");
  }
  const eligibleSubtotal = eligible.reduce((sum, index) => sum + lineTotals[index], 0);
  if (coupon.minOrderCents != null && eligibleSubtotal < coupon.minOrderCents) {
    throw new QuoteError(`This coupon requires a minimum of ${centsToString(coupon.minOrderCents)} before tax`);
  }
}
