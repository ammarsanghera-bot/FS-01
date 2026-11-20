import { Prisma } from "@prisma/client";
import type { OutboundEmail } from "./mailer.js";
import type { Db } from "./prisma.js";

export async function audit(
  db: Db,
  input: { actorId?: string | null; action: string; entity: string; entityId?: string | null; metadata?: Record<string, unknown>; ip?: string | null },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      ip: input.ip ?? null,
    },
  });
}

export async function notify(
  db: Db,
  input: { userId: string; type: string; title: string; body: string; data?: Record<string, unknown>; email?: OutboundEmail },
): Promise<OutboundEmail | null> {
  await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data as Prisma.InputJsonValue | undefined,
    },
  });
  return input.email ?? null;
}
