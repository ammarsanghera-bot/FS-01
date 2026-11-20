import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default function setup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  execSync("npx prisma db push --schema ../../prisma/schema.prisma --skip-generate --accept-data-loss", {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace_test",
    },
  });
}
