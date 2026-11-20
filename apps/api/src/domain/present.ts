import type { Prisma } from "@prisma/client";

type MoneyLike = { toFixed(digits: number): string };

export function money(value: MoneyLike | null | undefined): string | null {
  if (value == null) return null;
  return value.toFixed(2);
}

export function availableOf(inventory?: { quantity: number; reserved: number } | null): number {
  if (!inventory) return 0;
  return Math.max(0, inventory.quantity - inventory.reserved);
}

const imageOrder = { orderBy: { sortOrder: "asc" as const } };

export const cardInclude = {
  images: { ...imageOrder, take: 1 },
  store: { select: { id: true, name: true, slug: true, status: true } },
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  variants: { include: { inventory: true } },
} satisfies Prisma.ProductInclude;

export function productCard(product: Prisma.ProductGetPayload<{ include: typeof cardInclude }>) {
  const available = product.variants.reduce((sum, variant) => sum + availableOf(variant.inventory), 0);
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    price: money(product.price),
    compareAtPrice: money(product.compareAtPrice),
    ratingAvg: money(product.ratingAvg),
    ratingCount: product.ratingCount,
    salesCount: product.salesCount,
    status: product.status,
    image: product.images[0]?.url ?? null,
    inStock: available > 0,
    vendor: { name: product.store.name, slug: product.store.slug },
    category: { name: product.category.name, slug: product.category.slug },
    brand: product.brand ? { name: product.brand.name, slug: product.brand.slug } : null,
  };
}

export function presentUser(user: {
  id: string;
  email: string;
  role: string;
  status: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  vendorProfile?: { status: string; store?: { id: string; name: string; slug: string; status: string } | null } | null;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerifiedAt),
    vendorStatus: user.vendorProfile?.status ?? null,
    store: user.vendorProfile?.store
      ? { id: user.vendorProfile.store.id, name: user.vendorProfile.store.name, slug: user.vendorProfile.store.slug, status: user.vendorProfile.store.status }
      : null,
  };
}

export function presentAddress(address: {
  id: string;
  label: string | null;
  fullName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}) {
  return address;
}
