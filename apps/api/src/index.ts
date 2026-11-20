import { createApp } from "./app.js";
import { env } from "./config.js";
import { activeSearchEngine } from "./domain/search.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();
const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, "Northstar API listening");
  activeSearchEngine().catch((error) => logger.warn({ err: error }, "search probe failed"));
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
