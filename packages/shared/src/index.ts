import { z } from "zod";

export const APP_NAME = "Northstar";

export const roles = ["CUSTOMER", "VENDOR", "ADMIN"] as const;
export type Role = (typeof roles)[number];

export const customerOrderStatuses = [
  "CREATED",
  "AWAITING_PAYMENT",
  "PAID",
  "PROCESSING",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type CustomerOrderStatus = (typeof customerOrderStatuses)[number];

export const vendorOrderStatuses = [
  "PENDING",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type VendorOrderStatus = (typeof vendorOrderStatuses)[number];

export const productStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export type ProductStatus = (typeof productStatuses)[number];

export const payoutStatuses = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"] as const;
export type PayoutStatus = (typeof payoutStatuses)[number];

export const shippingMethods = [
  { id: "standard", label: "Standard", detail: "5–7 business days" },
  { id: "express", label: "Express", detail: "2–3 business days" },
] as const;
export type ShippingMethodId = (typeof shippingMethods)[number]["id"];

export function isShippingMethod(value: string): value is ShippingMethodId {
  return value === "standard" || value === "express";
}

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/[0-9]/, "Include a number");

const optionalText = (schema: z.ZodString) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

export const registerSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    password: passwordSchema,
    firstName: z.string().trim().min(1, "First name is required").max(60),
    lastName: z.string().trim().min(1, "Last name is required").max(60),
    role: z.enum(["CUSTOMER", "VENDOR"]).default("CUSTOMER"),
    storeName: optionalText(z.string().trim().min(2).max(80)),
    storeDescription: optionalText(z.string().trim().min(10).max(2000)),
    phone: optionalText(z.string().trim().max(40)),
    city: optionalText(z.string().trim().max(80)),
    region: optionalText(z.string().trim().max(80)),
    country: optionalText(z.string().trim().max(80)),
  })
  .superRefine((value, ctx) => {
    if (value.role === "VENDOR") {
      if (!value.storeName) {
        ctx.addIssue({ code: "custom", path: ["storeName"], message: "Store name is required" });
      }
      if (!value.storeDescription) {
        ctx.addIssue({ code: "custom", path: ["storeDescription"], message: "Tell shoppers about the store" });
      }
    }
  });

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  fullName: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(2).max(20),
  country: z.string().trim().min(2).max(80).default("US"),
  phone: z.string().trim().max(40).optional(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});

export const reviewSchema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(4).max(4000),
  images: z.array(z.string().url()).max(3).optional(),
});

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return slug || "item";
}

export function formatMoney(value: string | number, currency = "USD"): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export type ApiSuccess<T> = {
  success: true;
  message: string;
  data: T;
  meta: Record<string, unknown>;
};

export type ApiFailure = {
  success: false;
  message: string;
  errors: { path?: string; message: string }[];
};
