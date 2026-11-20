import rateLimit from "express-rate-limit";
import { env } from "../config.js";

function limiter(limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.rateLimitDisabled,
    message: { success: false, message: "Too many requests. Try again shortly.", errors: [] },
  });
}

export const authLimiter = limiter(40, 15 * 60 * 1000);
export const writeLimiter = limiter(60, 15 * 60 * 1000);
export const apiLimiter = limiter(600, 60 * 1000);
