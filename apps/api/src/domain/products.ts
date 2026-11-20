import { Prisma, type ProductStatus } from "@prisma/client";
import { audit, notify } from "../lib/activity.js";
import { AppError } from "../lib/errors.js";
import { sendEmail } from "../lib/mailer.js";
import { prisma, type Db } from "../lib/prisma.js";
import { cacheDel } from "../lib/redis.js";
import { uniqueSlug } from "./accounts.js";
import { availableOf } from "./present.js";
import { indexProduct } from "./search.js";
import { getSettings } from "./settings.js";

const HOME_CACHE_KEY = "catalog:home:v1";

export type VariantWrite = {
  id?: string;
  sku: string;
  name?: string;
  options?: Record<string, string>;
  price?: string | null;
  compareAtPrice?: string | null;
  quantity: number;
  lowStockThreshold?: number;
};

export type ProductWrite = {
  name: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  brandId?: string | null;
  price: string;
  compareAtPrice?: string | null;
  sku: string;
  tags?: string[];
  weightGrams?: number | null;
  lengthCm?: string | null;
  widthCm?: string | null;
  heightCm?: string | null;
  shippingInfo?: string | null;
  images?: { url: string; alt?: string }[];
  attributes?: { name: string; values: string[] }[];
  variants: VariantWrite[];
  submit?: boolean;
};

export async function requireStore(userId: string, mode: "read" | "write") {
  const profile = await prisma.vendorProfile.findUnique({ where: { userId }, include: { store: true } });
  if (!profile) throw new AppError("Vendor profile not found", 404);
  if (!profile.store || profile.status === "PENDING" || profile.status === "REJECTED") {
    throw new AppError("Your store is not approved yet", 403, [], "VENDOR_PENDING");
  }
  if (mode === "write" && (profile.status === "SUSPENDED" || profile.store.status === "SUSPENDED")) {
    throw new AppError("This store is suspended", 403, [], "VENDOR_SUSPENDED");
  }
  return profile.store;
}

export async function createProduct(storeId: string, input: ProductWrite, actorId: string) {
  const settings = await getSettings();
  const status = input.submit ? (settings.product_approval_required ? "PENDING_APPROVAL" : "APPROVED") : "DRAFT";
  const product = await prisma.$transaction(async (tx) => {
    await assertCategory(tx, input.categoryId);
    const slug = await uniqueSlug(tx, "product", input.name);
    const created = await tx.product.create({
      data: {
        ...scalarProduct(input),
        storeId,
        slug,
        status,
        publishedAt: status === "APPROVED" ? new Date() : null,
      },
    });
    await replaceChildren(tx, created.id, input, actorId);
    return created;
  });
  await indexProduct(product.id);
  await cacheDel(HOME_CACHE_KEY);
  return getOwnedProduct(product.id, storeId);
}

export async function updateProduct(productId: string, storeId: string, input: ProductWrite, actorId: string) {
  const existing = await prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
  if (!existing) throw new AppError("Product not found", 404);
  const settings = await getSettings();
  let status: ProductStatus = existing.status;
  if (input.submit) status = settings.product_approval_required ? "PENDING_APPROVAL" : "APPROVED";
  else if (existing.status === "APPROVED" && settings.product_approval_required) status = "PENDING_APPROVAL";
  const product = await prisma.$transaction(async (tx) => {
    await assertCategory(tx, input.categoryId);
    const updated = await tx.product.update({
      where: { id: productId },
      data: {
        ...scalarProduct(input),
        slug: existing.slug,
        status,
        rejectionReason: status === "APPROVED" ? null : existing.rejectionReason,
        publishedAt: status === "APPROVED" ? existing.publishedAt ?? new Date() : existing.publishedAt,
      },
    });
    await replaceChildren(tx, productId, input, actorId);
    return updated;
  });
  await indexProduct(product.id);
  await cacheDel(HOME_CACHE_KEY);
  return getOwnedProduct(product.id, storeId);
}

export async function submitProduct(productId: string, storeId: string) {
  const settings = await getSettings();
  const product = await prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404);
  const status: ProductStatus = settings.product_approval_required ? "PENDING_APPROVAL" : "APPROVED";
  const updated = await prisma.product.update({
    where: { id: productId },
    data: { status, publishedAt: status === "APPROVED" ? product.publishedAt ?? new Date() : product.publishedAt, rejectionReason: null },
  });
  await indexProduct(updated.id);
  await cacheDel(HOME_CACHE_KEY);
  return getOwnedProduct(updated.id, storeId);
}

export async function archiveProduct(productId: string, storeId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404);
  await prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED", deletedAt: new Date() } });
  await indexProduct(productId);
  await cacheDel(HOME_CACHE_KEY);
}

export async function moderateProduct(productId: string, actorId: string, decision: "APPROVED" | "REJECTED", reason?: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { store: { include: { vendorProfile: { include: { user: true } } } } } });
  if (!product || product.deletedAt) throw new AppError("Product not found", 404);
  if (decision === "REJECTED" && !reason?.trim()) throw new AppError("A rejection reason is required", 422);
  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      status: decision,
      rejectionReason: decision === "REJECTED" ? reason!.trim() : null,
      publishedAt: decision === "APPROVED" ? product.publishedAt ?? new Date() : product.publishedAt,
    },
  });
  await audit(prisma, { actorId, action: decision === "APPROVED" ? "product.approved" : "product.rejected", entity: "Product", entityId: productId, metadata: { reason } });
  await notify(prisma, {
    userId: product.store.vendorProfile.userId,
    type: decision === "APPROVED" ? "product.approved" : "product.rejected",
    title: decision === "APPROVED" ? "Product approved" : "Product needs changes",
    body: decision === "APPROVED" ? `${product.name} is live.` : `${product.name} was not approved. ${reason}`,
    email: {
      to: product.store.vendorProfile.user.email,
      subject: `${product.name} ${decision === "APPROVED" ? "approved" : "was not approved"}`,
      text: decision === "APPROVED" ? `${product.name} is now on Northstar.` : `${product.name} was not approved. ${reason}`,
    },
  });
  const mailbox = decision === "APPROVED"
    ? { to: product.store.vendorProfile.user.email, subject: `${product.name} approved`, text: `${product.name} is now on Northstar.` }
    : { to: product.store.vendorProfile.user.email, subject: `${product.name} was not approved`, text: `${product.name} was not approved. ${reason}` };
  await sendEmail(mailbox);
  await indexProduct(updated.id);
  await cacheDel(HOME_CACHE_KEY);
  return updated;
}

export async function getOwnedProduct(productId: string, storeId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId, deletedAt: null },
    include: productDetailInclude,
  });
  if (!product) throw new AppError("Product not found", 404);
  return serializeOwned(product);
}

function serializeOwned(product: Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>) {
  return {
    ...product,
    price: product.price.toFixed(2),
    compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
    lengthCm: product.lengthCm?.toFixed(2) ?? null,
    widthCm: product.widthCm?.toFixed(2) ?? null,
    heightCm: product.heightCm?.toFixed(2) ?? null,
    ratingAvg: product.ratingAvg.toFixed(2),
    variants: product.variants.map((variant) => ({
      ...variant,
      price: variant.price?.toFixed(2) ?? null,
      compareAtPrice: variant.compareAtPrice?.toFixed(2) ?? null,
      available: availableOf(variant.inventory),
      quantity: variant.inventory?.quantity ?? 0,
      reserved: variant.inventory?.reserved ?? 0,
      lowStockThreshold: variant.inventory?.lowStockThreshold ?? 5,
    })),
  };
}

export const productDetailInclude = {
  images: { orderBy: { sortOrder: "asc" as const } },
  variants: { include: { inventory: true }, orderBy: { sku: "asc" as const } },
  attributes: { include: { values: true } },
  category: true,
  brand: true,
  store: true,
} satisfies Prisma.ProductInclude;

async function assertCategory(tx: Db, categoryId: string) {
  const category = await tx.category.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) throw new AppError("Choose an active category", 422);
}

function scalarProduct(input: ProductWrite) {
  return {
    categoryId: input.categoryId,
    brandId: input.brandId || null,
    name: input.name.trim(),
    sku: input.sku.trim().toUpperCase(),
    description: input.description.trim(),
    shortDescription: input.shortDescription.trim(),
    price: input.price,
    compareAtPrice: input.compareAtPrice || null,
    weightGrams: input.weightGrams ?? null,
    lengthCm: input.lengthCm || null,
    widthCm: input.widthCm || null,
    heightCm: input.heightCm || null,
    shippingInfo: input.shippingInfo?.trim() || null,
    tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12),
  };
}

async function replaceChildren(tx: Db, productId: string, input: ProductWrite, actorId: string) {
  if (input.variants.length === 0) throw new AppError("Add at least one variant", 422);
  await tx.productImage.deleteMany({ where: { productId } });
  if (input.images?.length) {
    await tx.productImage.createMany({
      data: input.images.map((image, index) => ({ productId, url: image.url, alt: image.alt || input.name, sortOrder: index })),
    });
  }
  await tx.productAttribute.deleteMany({ where: { productId } });
  for (const attribute of input.attributes ?? []) {
    await tx.productAttribute.create({
      data: { productId, name: attribute.name.trim(), values: { create: attribute.values.map((value) => ({ value: value.trim() })).filter((value) => value.value) } },
    });
  }
  const existing = await tx.productVariant.findMany({ where: { productId }, include: { inventory: true } });
  const kept = new Set(input.variants.map((variant) => variant.id).filter(Boolean) as string[]);
  for (const variant of existing) {
    if (kept.has(variant.id)) continue;
    const sold = await tx.orderItem.count({ where: { variantId: variant.id } });
    if (sold > 0) throw new AppError(`Variant ${variant.sku} has orders and cannot be removed`, 409);
    await tx.cartItem.deleteMany({ where: { variantId: variant.id } });
    await tx.productVariant.delete({ where: { id: variant.id } });
  }
  for (const variant of input.variants) {
    const options = variant.options && Object.keys(variant.options).length ? variant.options : { Option: "Default" };
    const name = variant.name?.trim() || Object.values(options).join(" / ");
    if (!Number.isInteger(variant.quantity) || variant.quantity < 0) throw new AppError("Variant quantity must be a whole number", 422);
    if (variant.id) {
      const current = existing.find((item) => item.id === variant.id);
      if (!current) throw new AppError("Variant not found on this product", 404);
      if (current.inventory && variant.quantity < current.inventory.reserved) {
        throw new AppError(`${current.sku} cannot drop below reserved stock`, 409);
      }
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { sku: variant.sku.trim().toUpperCase(), name, options: options as Prisma.InputJsonValue, price: variant.price || null, compareAtPrice: variant.compareAtPrice || null },
      });
      if (current.inventory && current.inventory.quantity !== variant.quantity) {
        await tx.inventory.update({
          where: { id: current.inventory.id },
          data: { quantity: variant.quantity, lowStockThreshold: variant.lowStockThreshold ?? current.inventory.lowStockThreshold },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryId: current.inventory.id,
            type: "ADJUSTMENT",
            onHandDelta: variant.quantity - current.inventory.quantity,
            reservedDelta: 0,
            reason: "Updated with the product",
            createdById: actorId,
          },
        });
      }
    } else {
      const created = await tx.productVariant.create({
        data: {
          productId,
          sku: variant.sku.trim().toUpperCase(),
          name,
          options: options as Prisma.InputJsonValue,
          price: variant.price || null,
          compareAtPrice: variant.compareAtPrice || null,
          inventory: { create: { productId, quantity: variant.quantity, lowStockThreshold: variant.lowStockThreshold ?? 5 } },
        },
        include: { inventory: true },
      });
      await tx.inventoryMovement.create({
        data: {
          inventoryId: created.inventory!.id,
          type: "ADJUSTMENT",
          onHandDelta: variant.quantity,
          reservedDelta: 0,
          reason: "Initial stock",
          createdById: actorId,
        },
      });
    }
  }
}
