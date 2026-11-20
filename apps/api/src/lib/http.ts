import type { NextFunction, Request, Response } from "express";

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function ok(res: Response, data: unknown, message = "OK", meta: Record<string, unknown> = {}) {
  return res.json({ success: true, message, data, meta });
}

export function pageParams(query: Request["query"], fallback = 20) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(60, Math.max(1, Number(query.pageSize) || fallback));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export type Actor = { id: string; role: "CUSTOMER" | "VENDOR" | "ADMIN"; email: string };

export function actor(res: Response): Actor {
  return res.locals.user as Actor;
}
