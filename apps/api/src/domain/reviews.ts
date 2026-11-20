import { Prisma } from "@prisma/client";
import { audit, notify } from "../lib/activity.js";
import { AppError } from "../lib/errors.js";
import { prisma, type Db } from "../lib/prisma.js";
import { getSettings } from "./settings.js";

export async function createReview(userId: string, input: { productId: string; rating: number; title: string; body: string; images?: string[] }) {
  const purchased = await prisma.orderItem.findFirst({
    where: {
      productId: input.productId,
      customerOrder: {
        userId,
        payments: { some: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } } },
        status: { notIn: ["CANCELLED", "AWAITING_PAYMENT", "CREATED"] },
      },
    },
    orderBy: { customerOrder: { createdAt: "desc" } },
  });
  if (!purchased) throw new AppError("You can review a product after you purchase it", 403);
  const existing = await prisma.review.findUnique({ where: { productId_userId: { productId: input.productId, userId } } });
  if (existing) throw new AppError("You already reviewed this product", 409);
  const settings = await getSettings();
  const status = settings.review_moderation_required ? "PENDING" : "APPROVED";
  const review = await prisma.review.create({
    data: {
      productId: input.productId,
      userId,
      orderItemId: purchased.id,
      rating: input.rating,
      title: input.title.trim(),
      body: input.body.trim(),
      status,
      images: input.images ?? [],
    },
  });
  if (status === "APPROVED") await recomputeRatings(prisma, input.productId);
  return review;
}

export async function moderateReview(reviewId: string, actorId: string, status: "APPROVED" | "REJECTED") {
  const review = await prisma.review.update({ where: { id: reviewId }, data: { status } });
  await recomputeRatings(prisma, review.productId);
  await audit(prisma, { actorId, action: `review.${status.toLowerCase()}`, entity: "Review", entityId: reviewId });
  return review;
}

export async function respondToReview(reviewId: string, storeId: string, response: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, include: { product: true, user: true } });
  if (!review || review.product.storeId !== storeId) throw new AppError("Review not found", 404);
  const updated = await prisma.review.update({ where: { id: reviewId }, data: { vendorResponse: response.trim() } });
  await notify(prisma, {
    userId: review.userId,
    type: "review.response",
    title: "A maker replied to your review",
    body: response.trim().slice(0, 180),
  });
  return updated;
}

export async function recomputeRatings(db: Db, productId: string) {
  const aggregate = await db.review.aggregate({ where: { productId, status: "APPROVED" }, _avg: { rating: true }, _count: { rating: true } });
  const product = await db.product.update({
    where: { id: productId },
    data: { ratingAvg: (aggregate._avg.rating ?? 0).toFixed(2), ratingCount: aggregate._count.rating },
  });
  const storeAggregate = await db.review.aggregate({
    where: { status: "APPROVED", product: { storeId: product.storeId } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await db.store.update({
    where: { id: product.storeId },
    data: { ratingAvg: (storeAggregate._avg.rating ?? 0).toFixed(2), ratingCount: storeAggregate._count.rating },
  });
}

export async function ratingBreakdown(productId: string) {
  const rows = await prisma.review.groupBy({ by: ["rating"], where: { productId, status: "APPROVED" }, _count: { rating: true } });
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) counts[row.rating as 1 | 2 | 3 | 4 | 5] = row._count.rating;
  return counts;
}

export function presentReview(review: Prisma.ReviewGetPayload<{ include: { user: true } }>) {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    vendorResponse: review.vendorResponse,
    images: review.images,
    createdAt: review.createdAt,
    verified: true,
    author: `${review.user.firstName} ${review.user.lastName.slice(0, 1)}.`,
  };
}
