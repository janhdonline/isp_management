import { defineConfig } from "prisma/config";
import path from "node:path";

/**
 * Prisma 7 keeps connection strings out of schema.prisma.
 *
 * Point DATABASE_URL at any PostgreSQL server. `npm run db:pg` starts a real
 * PostgreSQL 18 on the default loopback address with nothing to install (see
 * scripts/pg-dev.mjs), so local and production run the same SQL.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/isp?schema=public",
  },
});
