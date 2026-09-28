import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single PostgreSQL client for the whole app.
 *
 * Prisma 7 uses a driver adapter, so the connection string lives here rather
 * than in schema.prisma — set DATABASE_URL to any PostgreSQL server (local
 * install, Supabase, RDS, Neon…) and the app is running.
 *
 * `@prisma/adapter-pg` is the official node-postgres driver adapter, so the
 * same code runs against `npm run db:pg` locally and a managed server in
 * production. There is no SQLite fallback: the data model, the migrations and
 * every query are PostgreSQL.
 */
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=public";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
