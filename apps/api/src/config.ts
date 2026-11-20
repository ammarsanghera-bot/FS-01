import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VITEST) {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace_test";
  process.env.REDIS_URL = "";
  process.env.ELASTICSEARCH_URL = "";
  process.env.RATE_LIMIT_DISABLED = "true";
  process.env.LOG_LEVEL = "silent";
}

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function required(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback || "";
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const devFallback = nodeEnv === "production" ? undefined : "ok";

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: Number(process.env.API_PORT || 4000),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
  publicApiUrl: (process.env.PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, ""),
  databaseUrl: required(
    "DATABASE_URL",
    devFallback ? "postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace" : undefined,
  ),
  redisUrl: optional("REDIS_URL"),
  elasticsearchUrl: optional("ELASTICSEARCH_URL").replace(/\/$/, ""),
  elasticsearchIndex: process.env.ELASTICSEARCH_INDEX || "products",
  jwtAccessSecret: required("JWT_ACCESS_SECRET", devFallback ? "dev-access-secret-change-me-please" : undefined),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", devFallback ? "dev-refresh-secret-change-me-please" : undefined),
  mockWebhookSecret: required("MOCK_WEBHOOK_SECRET", devFallback ? "dev-mock-webhook-secret" : undefined),
  cookieSecure: process.env.COOKIE_SECURE === "true" || nodeEnv === "production",
  cookieSameSite: (process.env.COOKIE_SAMESITE === "none" ? "none" : "lax") as "lax" | "none",
  storageDriver: process.env.STORAGE_DRIVER === "s3" ? "s3" : "local",
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || "uploads"),
  s3: {
    endpoint: optional("S3_ENDPOINT"),
    region: process.env.S3_REGION || "us-east-1",
    bucket: optional("S3_BUCKET"),
    accessKey: optional("S3_ACCESS_KEY"),
    secretKey: optional("S3_SECRET_KEY"),
    publicUrl: optional("S3_PUBLIC_URL").replace(/\/$/, ""),
  },
  stripeSecretKey: optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  smtp: {
    host: optional("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT || 587),
    user: optional("SMTP_USER"),
    pass: optional("SMTP_PASS"),
    from: process.env.SMTP_FROM || "Northstar <hello@northstar.market>",
  },
  rateLimitDisabled: process.env.RATE_LIMIT_DISABLED === "true" || nodeEnv === "test",
  logLevel: process.env.LOG_LEVEL || (nodeEnv === "test" ? "silent" : "info"),
};

if (env.jwtAccessSecret.length < 16 || env.jwtRefreshSecret.length < 16) {
  throw new Error("JWT secrets must be at least 16 characters");
}
