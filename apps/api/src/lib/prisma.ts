import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config.js";

export const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
  log: env.isTest ? [] : ["error"],
});

export type Db = PrismaClient | Prisma.TransactionClient;
