import { Router } from "express";
import multer from "multer";
import { env } from "../config.js";
import { handlePaymentWebhook } from "../domain/commerce.js";
import { AppError } from "../lib/errors.js";
import { asyncHandler, ok } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { saveImage } from "../lib/storage.js";
import { optionalUser, requireUser, sessionHeader } from "../middleware/auth.js";
import { maintenanceGuard } from "../middleware/maintenance.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import { adminRouter } from "./admin.js";
import { authRouter } from "./auth.js";
import { shopRouter } from "./shop.js";
import { vendorRouter } from "./vendor.js";

export const api = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

api.use(apiLimiter);
api.use(sessionHeader);
api.use(optionalUser);
api.use(maintenanceGuard);

api.post("/payments/webhook", asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = req.header("stripe-signature") || req.header("x-mock-signature") || undefined;
  ok(res, await handlePaymentWebhook(raw, signature), "Webhook received");
}));

api.post("/uploads", requireUser(["VENDOR", "ADMIN"]), upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("Choose an image", 422);
  ok(res, await saveImage({ mimetype: req.file.mimetype, buffer: req.file.buffer, originalname: req.file.originalname }), "Uploaded");
}));

api.use("/auth", authRouter);
api.use("/vendor", vendorRouter);
api.use("/admin", adminRouter);
api.use(shopRouter);

if (!env.isProduction) {
  api.get("/dev/mailbox", asyncHandler(async (_req, res) => {
    ok(res, await prisma.devEmail.findMany({ orderBy: { createdAt: "desc" }, take: 40 }));
  }));
}
