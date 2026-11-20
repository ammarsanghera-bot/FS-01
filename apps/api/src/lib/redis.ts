import Redis from "ioredis";
import { env } from "../config.js";
import { logger } from "./logger.js";

let client: Redis | null = null;
let disabled = !env.redisUrl;

export function getRedis(): Redis | null {
  if (disabled || !env.redisUrl) return null;
  if (!client) {
    client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 1000,
    });
    client.on("error", (error) => {
      logger.warn({ err: error.message }, "redis unavailable, continuing without cache");
    });
  }
  return client;
}

async function readyRedis(): Promise<Redis | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    if (redis.status === "connecting") {
      await new Promise<void>((resolve, reject) => {
        redis.once("ready", () => resolve());
        redis.once("end", () => reject(new Error("redis closed")));
      });
    }
    return redis.status === "ready" ? redis : null;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : "redis" }, "redis unavailable, continuing without cache");
    return null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = await readyRedis();
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = await readyRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch {
    /* cache is optional */
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = await readyRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    /* cache is optional */
  }
}

export async function redisStatus(): Promise<"up" | "down" | "disabled"> {
  if (!env.redisUrl) return "disabled";
  const redis = await readyRedis();
  if (!redis) return env.redisUrl ? "down" : "disabled";
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? "up" : "down";
  } catch {
    return "down";
  }
}
