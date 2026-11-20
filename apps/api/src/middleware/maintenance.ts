import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { getSettings } from "../domain/settings.js";

export async function maintenanceGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.path === "/health" || req.path.startsWith("/auth/") || req.path.startsWith("/dev/")) return next();
  const settings = await getSettings();
  if (!settings.maintenance_mode) return next();
  const header = req.header("authorization") || "";
  if (header.startsWith("Bearer ")) {
    try {
      const claims = verifyAccessToken(header.slice(7));
      if (claims.role === "ADMIN") return next();
    } catch {
      /* fall through */
    }
  }
  next(new AppError("Northstar is temporarily down for maintenance", 503, [], "MAINTENANCE"));
}
