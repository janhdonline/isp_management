import path from "node:path";
import { defineConfig } from "prisma/config";
import { DEFAULT_DATABASE_URL } from "./src/lib/db-url";

/**
 * Prisma 7 keeps connection strings out of `schema.prisma`, so they are decided
 * here — and they are decided differently for the two jobs that need them.
 *
 * ## Two URLs, not one
 *
 * A hosted Postgres that scales usually offers two connection strings:
 *
 *  - a **pooled** URL, which routes through a connection pooler (Neon and
 *    Supabase both call it the "pooled" endpoint). This is what the running
 *    application must use: serverless functions open a lot of short-lived
 *    connections, and an unbounded one per request exhausts the database's
 *    connection limit within minutes.
 *  - a **direct** URL, which connects straight to the database. Migrations must
 *    use this one, because a pooler does not support the session-level
 *    operations a migration needs (`SET`, advisory locks, and the transaction
 *    that wraps the whole thing).
 *
 * Getting this backwards is quiet and expensive: migrations through a pooler fail
 * in confusing ways, and the application through a direct URL falls over under
 * load. So the two are named separately rather than reusing one variable.
 *
 * Locally there is no pooler, so both resolve to the same address and nothing
 * needs configuring.
 */

const pooled =
  process.env.DATABASE_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  DEFAULT_DATABASE_URL;

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations and `db:push` use the direct endpoint. Falls back to the pooled
    // one, which is correct locally and a deliberate no-op when only one URL is
    // configured.
    url: process.env.DIRECT_URL?.trim() || pooled,
  },
});
