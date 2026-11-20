import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type Banner = { title: string; subtitle: string; href: string; image: string };

export type PlatformSettings = {
  marketplace_name: string;
  currency: string;
  default_commission_rate: number;
  vendor_approval_required: boolean;
  product_approval_required: boolean;
  tax_rate: number;
  free_shipping_threshold: number;
  standard_shipping: number;
  express_shipping: number;
  maintenance_mode: boolean;
  review_moderation_required: boolean;
  support_email: string;
  announcement: string;
  require_verified_email: boolean;
  homepage_banners: Banner[];
};

export const SETTING_DEFAULTS: PlatformSettings = {
  marketplace_name: "Northstar",
  currency: "USD",
  default_commission_rate: 10,
  vendor_approval_required: true,
  product_approval_required: true,
  tax_rate: 8,
  free_shipping_threshold: 75,
  standard_shipping: 6.5,
  express_shipping: 14,
  maintenance_mode: false,
  review_moderation_required: true,
  support_email: "hello@northstar.market",
  announcement: "Complimentary standard shipping on orders over $75",
  require_verified_email: false,
  homepage_banners: [
    {
      title: "Linen, cut close to the season",
      subtitle: "Shirts, trousers, and layers from Atelier Maya.",
      href: "/c/apparel",
      image: "https://picsum.photos/seed/northstar-linen/1400/900",
    },
    {
      title: "Tools for the table and the trail",
      subtitle: "Cast iron, wool, and kit from Field & Co.",
      href: "/store/field-and-co",
      image: "https://picsum.photos/seed/northstar-trail/1400/900",
    },
  ],
};

let cache: { at: number; value: PlatformSettings } | null = null;

export function clearSettingsCache(): void {
  cache = null;
}

export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const rows = await prisma.platformSetting.findMany();
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const value: PlatformSettings = {
    marketplace_name: asString(stored.get("marketplace_name"), SETTING_DEFAULTS.marketplace_name),
    currency: asString(stored.get("currency"), SETTING_DEFAULTS.currency),
    default_commission_rate: asNumber(stored.get("default_commission_rate"), SETTING_DEFAULTS.default_commission_rate),
    vendor_approval_required: asBoolean(stored.get("vendor_approval_required"), SETTING_DEFAULTS.vendor_approval_required),
    product_approval_required: asBoolean(stored.get("product_approval_required"), SETTING_DEFAULTS.product_approval_required),
    tax_rate: asNumber(stored.get("tax_rate"), SETTING_DEFAULTS.tax_rate),
    free_shipping_threshold: asNumber(stored.get("free_shipping_threshold"), SETTING_DEFAULTS.free_shipping_threshold),
    standard_shipping: asNumber(stored.get("standard_shipping"), SETTING_DEFAULTS.standard_shipping),
    express_shipping: asNumber(stored.get("express_shipping"), SETTING_DEFAULTS.express_shipping),
    maintenance_mode: asBoolean(stored.get("maintenance_mode"), SETTING_DEFAULTS.maintenance_mode),
    review_moderation_required: asBoolean(stored.get("review_moderation_required"), SETTING_DEFAULTS.review_moderation_required),
    support_email: asString(stored.get("support_email"), SETTING_DEFAULTS.support_email),
    announcement: asString(stored.get("announcement"), SETTING_DEFAULTS.announcement),
    require_verified_email: asBoolean(stored.get("require_verified_email"), SETTING_DEFAULTS.require_verified_email),
    homepage_banners: asBanners(stored.get("homepage_banners")),
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const entries = Object.entries(partial).filter(([, value]) => value !== undefined);
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.platformSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      }),
    ),
  );
  clearSettingsCache();
  return getSettings();
}

export async function ensureDefaultSettings(): Promise<void> {
  await saveSettings(SETTING_DEFAULTS);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asBanners(value: unknown): Banner[] {
  if (!Array.isArray(value)) return SETTING_DEFAULTS.homepage_banners;
  const banners = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.title !== "string" || typeof record.href !== "string") return null;
      return {
        title: record.title,
        subtitle: typeof record.subtitle === "string" ? record.subtitle : "",
        href: record.href,
        image: typeof record.image === "string" ? record.image : "",
      };
    })
    .filter((item): item is Banner => Boolean(item));
  return banners.length ? banners : SETTING_DEFAULTS.homepage_banners;
}
