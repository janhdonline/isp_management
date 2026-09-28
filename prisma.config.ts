import { defineConfig } from "prisma/config";
import path from "node:path";
import { DEFAULT_DATABASE_URL } from "./src/lib/db-url";

/**
 * Prisma 7 keeps connection strings out of schema.prisma.
 *
 * The fallback is the same constant the app uses (src/lib/db-url.ts), so the
 * CLI, the seed and the running server cannot end up on different databases.
 * `npm run db:pg` starts a real PostgreSQL on that default address; point
 * DATABASE_URL anywhere else for a hosted server.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
  },
});
