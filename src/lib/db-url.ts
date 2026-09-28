/**
 * The one place the PostgreSQL connection string is defined.
 *
 * Next.js loads `.env` automatically, but the Prisma CLI, the seed and the
 * maintenance scripts all run outside it — and a fallback that disagrees with
 * `.env` silently points them at a different database. Sharing a single
 * constant means there is nothing left to disagree about.
 */
export const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/isp?schema=public";

/** The connection string in use, from the environment when it is set. */
export const databaseUrl = (): string =>
  process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
