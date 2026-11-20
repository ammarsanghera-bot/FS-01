import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: error.issues[0]?.message || "Check the form",
      errors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  if (error instanceof AppError) {
    return res.status(error.status).json({ success: false, message: error.message, errors: error.errors, code: error.code });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ success: false, message: "That value is already in use", errors: [] });
  }
  logger.error({ err: error, path: req.originalUrl }, "request failed");
  return res.status(500).json({
    success: false,
    message: env.isProduction ? "Something went wrong" : error instanceof Error ? error.message : "Something went wrong",
    errors: [],
  });
}
