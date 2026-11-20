import { AppError, QuoteError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { buildQuote, presentQuote } from "./commerce.js";
import { availableOf } from "./present.js";

const cartInclude = {
  items: {
    include: {
      product: { include: { images: { orderBy: { sortOrder: "asc" as const }, take: 1 }, store: true } },
      variant: { include: { inventory: true } },
    },
    orderBy: { id: "asc" as const },
  },
};

export async function getOrCreateCart(input: { userId?: string | null; sessionId?: string | null }) {
  if (input.userId) {
    return prisma.cart.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {},
      include: cartInclude,
    });
  }
  if (!input.sessionId) throw new AppError("Missing session", 400);
  return prisma.cart.upsert({
    where: { sessionId: input.sessionId },
    create: { sessionId: input.sessionId },
    update: {},
    include: cartInclude,
  });
}

export async function mergeGuestCart(userId: string, sessionId?: string | null) {
  if (!sessionId) return;
  const guest = await prisma.cart.findUnique({ where: { sessionId }, include: { items: true } });
  if (!guest) {
    await mergeWishlist(userId, sessionId);
    return;
  }
  const userCart = await prisma.cart.upsert({ where: { userId }, create: { userId }, update: {} });
  if (guest.id !== userCart.id) {
    for (const item of guest.items) {
      const existing = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } } });
      if (existing) {
        await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: Math.min(99, existing.quantity + item.quantity) } });
      } else {
        await prisma.cartItem.create({
          data: { cartId: userCart.id, productId: item.productId, variantId: item.variantId, quantity: item.quantity },
        });
      }
    }
    if (!userCart.couponCode && guest.couponCode) {
      await prisma.cart.update({ where: { id: userCart.id }, data: { couponCode: guest.couponCode } });
    }
    await prisma.cart.delete({ where: { id: guest.id } });
  }
  await mergeWishlist(userId, sessionId);
}

async function mergeWishlist(userId: string, sessionId: string) {
  const guest = await prisma.wishlist.findUnique({ where: { sessionId }, include: { items: true } });
  if (!guest) return;
  const wishlist = await prisma.wishlist.upsert({ where: { userId }, create: { userId }, update: {} });
  if (guest.id === wishlist.id) return;
  for (const item of guest.items) {
    await prisma.wishlistItem.upsert({
      where: { wishlistId_productId: { wishlistId: wishlist.id, productId: item.productId } },
      create: { wishlistId: wishlist.id, productId: item.productId },
      update: {},
    });
  }
  await prisma.wishlist.delete({ where: { id: guest.id } });
}

export async function addCartItem(input: { userId?: string | null; sessionId?: string | null; variantId: string; quantity: number }) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    include: { inventory: true, product: { include: { store: true } } },
  });
  if (!variant || variant.product.deletedAt || variant.product.status !== "APPROVED" || variant.product.store.status !== "APPROVED") {
    throw new AppError("That product is not available", 404);
  }
  const cart = await getOrCreateCart(input);
  const existing = cart.items.find((item) => item.variantId === variant.id);
  const next = (existing?.quantity ?? 0) + input.quantity;
  if (next < 1 || next > 99) throw new AppError("Quantity must be between 1 and 99", 422);
  if (next > availableOf(variant.inventory)) throw new AppError("Not enough stock for that quantity", 409);
  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: next } });
  } else {
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: variant.productId, variantId: variant.id, quantity: next } });
  }
  return presentCart(await getOrCreateCart(input), input.userId);
}

export async function updateCartItem(input: { userId?: string | null; sessionId?: string | null; itemId: string; quantity: number }) {
  const cart = await getOrCreateCart(input);
  const item = cart.items.find((entry) => entry.id === input.itemId);
  if (!item) throw new AppError("Cart item not found", 404);
  if (input.quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
  } else {
    if (input.quantity > 99) throw new AppError("Quantity must be between 1 and 99", 422);
    if (input.quantity > availableOf(item.variant.inventory)) throw new AppError("Not enough stock for that quantity", 409);
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } });
  }
  return presentCart(await getOrCreateCart(input), input.userId);
}

export async function removeCartItem(input: { userId?: string | null; sessionId?: string | null; itemId: string }) {
  const cart = await getOrCreateCart(input);
  const item = cart.items.find((entry) => entry.id === input.itemId);
  if (item) await prisma.cartItem.delete({ where: { id: item.id } });
  return presentCart(await getOrCreateCart(input), input.userId);
}

export async function setCartCoupon(input: { userId?: string | null; sessionId?: string | null; couponCode: string | null }) {
  const cart = await getOrCreateCart(input);
  const couponCode = input.couponCode ? input.couponCode.trim().toUpperCase() : null;
  if (couponCode) {
    if (!input.userId) throw new AppError("Sign in to use a coupon", 401);
    if (cart.items.length === 0) throw new AppError("Add an item before applying a coupon", 400);
    await buildQuote(prisma, cart.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })), {
      userId: input.userId,
      couponCode,
      shippingMethod: "standard",
    });
  }
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode } });
  return presentCart(await getOrCreateCart(input), input.userId);
}

export async function presentCart(cart: Awaited<ReturnType<typeof getOrCreateCart>>, userId?: string | null) {
  const items = cart.items.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    product: {
      id: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      image: item.product.images[0]?.url ?? null,
    },
    variant: {
      id: item.variant.id,
      sku: item.variant.sku,
      options: item.variant.options,
      available: availableOf(item.variant.inventory),
    },
    store: { name: item.product.store.name, slug: item.product.store.slug },
  }));
  let quote = null;
  const issues: string[] = [];
  if (items.length) {
    try {
      quote = presentQuote(await buildQuote(prisma, items.map((item) => ({ variantId: item.variant.id, quantity: item.quantity })), {
        userId: userId || "guest",
        couponCode: cart.couponCode,
        shippingMethod: "standard",
      }));
    } catch (error) {
      if (error instanceof QuoteError || error instanceof AppError) issues.push(error.message);
      else throw error;
    }
  }
  return { id: cart.id, couponCode: cart.couponCode, items, quote, issues };
}

export async function wishlistFor(input: { userId?: string | null; sessionId?: string | null }) {
  const wishlist = await getOrCreateWishlist(input);
  return {
    id: wishlist.id,
    items: wishlist.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      createdAt: item.createdAt,
      product: {
        id: item.product.id,
        name: item.product.name,
        slug: item.product.slug,
        price: item.product.price.toFixed(2),
        image: item.product.images[0]?.url ?? null,
        inStock: item.product.variants.some((variant) => availableOf(variant.inventory) > 0),
        vendor: { name: item.product.store.name, slug: item.product.store.slug },
      },
    })),
  };
}

async function getOrCreateWishlist(input: { userId?: string | null; sessionId?: string | null }) {
  const include = {
    items: {
      include: { product: { include: { images: { take: 1, orderBy: { sortOrder: "asc" as const } }, store: true, variants: { include: { inventory: true } } } } },
      orderBy: { createdAt: "desc" as const },
    },
  };
  if (input.userId) {
    return prisma.wishlist.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {}, include });
  }
  if (!input.sessionId) throw new AppError("Missing session", 400);
  return prisma.wishlist.upsert({ where: { sessionId: input.sessionId }, create: { sessionId: input.sessionId }, update: {}, include });
}

export async function addWishlistItem(input: { userId?: string | null; sessionId?: string | null; productId: string }) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null, status: "APPROVED" } });
  if (!product) throw new AppError("Product not found", 404);
  const wishlist = await getOrCreateWishlist(input);
  await prisma.wishlistItem.upsert({
    where: { wishlistId_productId: { wishlistId: wishlist.id, productId: product.id } },
    create: { wishlistId: wishlist.id, productId: product.id },
    update: {},
  });
  return wishlistFor(input);
}

export async function removeWishlistItem(input: { userId?: string | null; sessionId?: string | null; productId: string }) {
  const wishlist = await getOrCreateWishlist(input);
  await prisma.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id, productId: input.productId } });
  return wishlistFor(input);
}
