import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 40000,
    setupFiles: ["./src/tests/env.ts"],
    globalSetup: "./src/tests/global-setup.ts",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace_test",
      REDIS_URL: "",
      ELASTICSEARCH_URL: "",
      JWT_ACCESS_SECRET: "test-access-secret-should-be-long-enough",
      JWT_REFRESH_SECRET: "test-refresh-secret-should-be-long-enough",
      MOCK_WEBHOOK_SECRET: "test-mock-webhook-secret",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_API_URL: "http://localhost:4000",
      RATE_LIMIT_DISABLED: "true",
      LOG_LEVEL: "silent",
      COOKIE_SECURE: "false",
      COOKIE_SAMESITE: "lax",
      STORAGE_DRIVER: "local",
    },
  },
});
