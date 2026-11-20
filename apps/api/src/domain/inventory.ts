import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma, type Db } from "../lib/prisma.js";

type StockLine = { variantId: string; quantity: number; name: string };

async function lockInventory(tx: Db, variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Inventory" WHERE "variantId" IN (${Prisma.join(variantIds)}) FOR UPDATE`;
}

export async function reserveLines(tx: Db, lines: StockLine[], referenceId: string, actorId?: string): Promise<void> {
  await lockInventory(tx, lines.map((line) => line.variantId));
  for (const line of lines) {
    const inventory = await tx.inventory.findUnique({ where: { variantId: line.variantId } });
    if (!inventory) throw new AppError(`${line.name} is not stocked`, 409);
    const updated = await tx.$executeRaw`
      UPDATE "Inventory"
      SET reserved = reserved + ${line.quantity}
      WHERE id = ${inventory.id} AND (quantity - reserved) >= ${line.quantity}
    `;
    if (Number(updated) !== 1) throw new AppError(`${line.name} does not have enough stock`, 409);
    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        type: "RESERVATION",
        onHandDelta: 0,
        reservedDelta: line.quantity,
        reason: "Reserved at checkout",
        referenceType: "CustomerOrder",
        referenceId,
        createdById: actorId,
      },
    });
  }
}

export async function commitReservations(tx: Db, lines: StockLine[], referenceId: string): Promise<void> {
  await lockInventory(tx, lines.map((line) => line.variantId));
  for (const line of lines) {
    const inventory = await tx.inventory.findUnique({ where: { variantId: line.variantId } });
    if (!inventory) throw new AppError(`${line.name} is not stocked`, 409);
    const updated = await tx.$executeRaw`
      UPDATE "Inventory"
      SET quantity = quantity - ${line.quantity}, reserved = reserved - ${line.quantity}
      WHERE id = ${inventory.id} AND reserved >= ${line.quantity} AND quantity >= ${line.quantity}
    `;
    if (Number(updated) !== 1) throw new AppError(`Could not commit stock for ${line.name}`, 409);
    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        type: "SALE",
        onHandDelta: -line.quantity,
        reservedDelta: -line.quantity,
        reason: "Sold",
        referenceType: "CustomerOrder",
        referenceId,
      },
    });
    await tx.$executeRaw`
      UPDATE "Product" SET "salesCount" = "salesCount" + ${line.quantity} WHERE id = ${inventory.productId}
    `;
  }
}

export async function releaseReservations(tx: Db, lines: StockLine[], referenceId: string): Promise<void> {
  await lockInventory(tx, lines.map((line) => line.variantId));
  for (const line of lines) {
    const inventory = await tx.inventory.findUnique({ where: { variantId: line.variantId } });
    if (!inventory) continue;
    await tx.$executeRaw`
      UPDATE "Inventory"
      SET reserved = GREATEST(reserved - ${line.quantity}, 0)
      WHERE id = ${inventory.id}
    `;
    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        type: "RELEASE",
        onHandDelta: 0,
        reservedDelta: -line.quantity,
        reason: "Reservation released",
        referenceType: "CustomerOrder",
        referenceId,
      },
    });
  }
}

export async function restockLines(tx: Db, lines: StockLine[], referenceId: string): Promise<void> {
  for (const line of lines) {
    const inventory = await tx.inventory.findUnique({ where: { variantId: line.variantId } });
    if (!inventory) continue;
    await tx.$executeRaw`
      UPDATE "Inventory" SET quantity = quantity + ${line.quantity} WHERE id = ${inventory.id}
    `;
    await tx.$executeRaw`
      UPDATE "Product" SET "salesCount" = GREATEST("salesCount" - ${line.quantity}, 0) WHERE id = ${inventory.productId}
    `;
    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        type: "REFUND",
        onHandDelta: line.quantity,
        reservedDelta: 0,
        reason: "Restocked after refund",
        referenceType: "CustomerOrder",
        referenceId,
      },
    });
  }
}

export async function adjustInventory(input: { variantId: string; delta: number; reason: string; actorId: string; storeId: string }) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new AppError("Enter a non-zero whole-number adjustment", 422);
  return prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findUnique({
      where: { variantId: input.variantId },
      include: { variant: { include: { product: true } } },
    });
    if (!inventory || inventory.variant.product.storeId !== input.storeId) {
      throw new AppError("Inventory record not found", 404);
    }
    const next = inventory.quantity + input.delta;
    if (next < 0) throw new AppError("Stock cannot go below zero", 409);
    if (next < inventory.reserved) throw new AppError("Stock cannot drop below the reserved quantity", 409);
    await tx.inventory.update({ where: { id: inventory.id }, data: { quantity: next } });
    await tx.inventoryMovement.create({
      data: {
        inventoryId: inventory.id,
        type: "ADJUSTMENT",
        onHandDelta: input.delta,
        reservedDelta: 0,
        reason: input.reason,
        createdById: input.actorId,
        referenceType: "Adjustment",
      },
    });
    return tx.inventory.findUnique({ where: { id: inventory.id }, include: { variant: true, movements: { orderBy: { createdAt: "desc" }, take: 10 } } });
  });
}
