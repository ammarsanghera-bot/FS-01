import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error.js";
import { openApi } from "./openapi.js";
import { api } from "./routes/index.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use((req, res, next) => {
    if (req.path === "/api/v1/payments/webhook") return express.raw({ type: "*/*", limit: "1mb" })(req, res, next);
    return express.json({ limit: "1mb" })(req, res, next);
  });
  app.use(cookieParser());
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (!env.isTest) logger.info({ method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });
  app.use("/uploads", express.static(env.uploadDir));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApi));
  app.get("/api/docs.json", (_req, res) => res.json(openApi));
  app.use("/api/v1", api);
  app.use((_req, res) => res.status(404).json({ success: false, message: "Not found", errors: [] }));
  app.use(errorHandler);
  return app;
}
