/**
 * The wallet reconciliation guard.
 *
 * For every customer, the wallet ledger must sum to the cached
 * `Customer.advancePayment`. It is a property of the design rather than something
 * to enforce afterwards — `post()` writes both inside one transaction and nothing
 * else writes either — so this exists to prove it on a running database, where a
 * later change could quietly break it.
 *
 * Prints the drifted customers and exits non-zero, so `npm run verify` fails
 * rather than scrolling past.
 */
import { prisma } from "../src/lib/prisma";

try {
  const rows = (await prisma.$queryRaw`
    SELECT
      c.id                                        AS "customerId",
      COALESCE(SUM(w.amount), 0)::float8          AS ledger,
      COALESCE(c."advancePayment", 0)::float8     AS cached
    FROM "Customer" c
    LEFT JOIN "WalletTransaction" w ON w."customerId" = c.id
    GROUP BY c.id, c."advancePayment"
    HAVING ABS(COALESCE(SUM(w.amount), 0) - COALESCE(c."advancePayment", 0)) > 0.005
  `) as { customerId: string; ledger: number; cached: number }[];

  const total = await prisma.customer.count();
  if (rows.length === 0) {
    console.log(`wallet reconciles: ${total} customer(s), no drift`);
  } else {
    console.error(`wallet does NOT reconcile for ${rows.length} customer(s):`);
    for (const r of rows) {
      console.error(
        `  ${r.customerId}: ledger ${Number(r.ledger).toFixed(2)} vs balance ${Number(r.cached).toFixed(2)}`
      );
    }
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}