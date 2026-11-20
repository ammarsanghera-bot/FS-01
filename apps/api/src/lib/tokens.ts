import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import type { Role } from "@marketplace/shared";

export type AccessClaims = { sub: string; role: Role; email: string };

export function signAccessToken(user: { id: string; role: Role; email: string }): string {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtAccessSecret, { expiresIn: "15m" });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, env.jwtAccessSecret) as AccessClaims;
  if (!payload.sub || !payload.role) throw new Error("Invalid token");
  return payload;
}

export function newSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function makeOrderNumber(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;
}
