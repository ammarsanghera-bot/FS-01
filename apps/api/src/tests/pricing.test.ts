import { describe, expect, it } from "vitest";
import { quoteCart, type PricingSettings, type QuoteLineInput } from "../domain/pricing.js";

const settings: PricingSettings = {
  taxRatePercent: 0,
  freeShippingThresholdCents: 1_000_000,
  standardShippingCents: 0,
  expressShippingCents: 0,
  defaultCommissionRate: 10,
};

function line(overrides: Partial<QuoteLineInput> = {}): QuoteLineInput {
  return {
    variantId: "v",
    productId: "p",
    storeId: "s",
    categoryId: "c",
    storeName: "Harbor Home",
    name: "Bowl",
    sku: "BOWL",
    options: {},
    quantity: 1,
    unitPriceCents: 10_000,
    available: 5,
    vendorRate: null,
    categoryRate: null,
    ...overrides,
  };
}

describe("commission pricing", () => {
  it("keeps the worked example: $100 at 10% is $10 platform and $90 vendor", () => {
    const quote = quoteCart({ lines: [line()], coupon: null, shippingMethod: "standard", settings });
    expect(quote.groups[0].commissionCents).toBe(1000);
    expect(quote.groups[0].vendorEarningsCents).toBe(9000);
    expect(quote.groups[0].lines[0].commissionSource).toBe("GLOBAL");
  });

  it("uses a vendor rate before a category rate and splits two stores", () => {
    const quote = quoteCart({
      lines: [
        line({ variantId: "a", storeId: "maya", storeName: "Atelier", quantity: 2, unitPriceCents: 5000, vendorRate: null, categoryRate: 15 }),
        line({ variantId: "b", storeId: "field", storeName: "Field", quantity: 1, unitPriceCents: 2500, vendorRate: 8, categoryRate: 15 }),
      ],
      coupon: null,
      shippingMethod: "standard",
      settings: { ...settings, taxRatePercent: 8, freeShippingThresholdCents: 7500 },
    });
    expect(quote.subtotalCents).toBe(12500);
    expect(quote.shippingCents).toBe(0);
    expect(quote.taxCents).toBe(1000);
    expect(quote.grandTotalCents).toBe(13500);
    const maya = quote.groups.find((group) => group.storeId === "maya");
    const field = quote.groups.find((group) => group.storeId === "field");
    expect(maya?.commissionCents).toBe(1500);
    expect(maya?.lines[0].commissionSource).toBe("CATEGORY");
    expect(maya?.vendorEarningsCents).toBe(8500);
    expect(field?.commissionCents).toBe(200);
    expect(field?.lines[0].commissionSource).toBe("VENDOR");
    expect(field?.vendorEarningsCents).toBe(2300);
  });

  it("rejects an expired coupon and an oversell", () => {
    expect(() => quoteCart({
      lines: [line()],
      shippingMethod: "standard",
      settings,
      coupon: {
        id: "c", code: "OLD", type: "PERCENTAGE", amountCents: 0, percent: 10, minOrderCents: null, maxDiscountCents: null,
        storeId: null, usageLimit: null, perUserLimit: null, usageCount: 0, userUsageCount: 0, active: true,
        startsAt: null, expiresAt: new Date("2020-01-01"),
      },
    })).toThrow(/expired/);
    expect(() => quoteCart({ lines: [line({ quantity: 3, available: 2 })], coupon: null, shippingMethod: "standard", settings })).toThrow(/available/);
  });
});
