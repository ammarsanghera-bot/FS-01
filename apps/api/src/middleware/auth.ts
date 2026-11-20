import type { Role } from "@marketplace/shared";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/tokens.js";
import type { Actor } from "../lib/http.js";

export function sessionHeader(req: Request, res: Response, next: NextFunction) {
  const raw = req.header("x-session-id") || "";
  res.locals.sessionId = /^[a-zA-Z0-9_-]{8,80}$/.test(raw) ? raw : null;
  next();
}

export async function optionalUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return next();
  try {
    const claims = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    if (user && !user.deletedAt && user.status === "ACTIVE") {
      _res.locals.user = { id: user.id, role: user.role, email: user.email } satisfies Actor;
    }
  } catch {
    /* Anonymous requests stay anonymous. */
  }
  next();
}

export function requireUser(roles: Role[] = []) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization") || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token) return next(new AppError("Sign in required", 401));
      const claims = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user || user.deletedAt || user.status !== "ACTIVE") return next(new AppError("Sign in required", 401));
      if (roles.length && !roles.includes(user.role)) return next(new AppError("You do not have access to this", 403));
      const actor: Actor = { id: user.id, role: user.role, email: user.email };
      res.locals.user = actor;
      next();
    } catch {
      next(new AppError("Sign in required", 401));
    }
  };
}
