/**
 * Moves data from the original SQLite database into PostgreSQL.
 *
 * SQLite is read with `better-sqlite3` directly (the generated Prisma client is
 * bound to one provider, so it cannot query both) and written through Prisma,
 * so field types are converted by the generated client rather than by hand.
 * Rows are inserted in dependency order, and any row that cannot be written is
 * reported instead of silently dropped.
 *
 *   npm run db:pg          # terminal 1 — a PostgreSQL to receive the data
 *   npm run migrate:from:sqlite
 */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrl } from "../src/lib/db-url";
import { PrismaClient } from "../src/generated/prisma/client";

const sqliteFile = path.resolve(process.argv[2] ?? "./dev.db");
const targetUrl = databaseUrl();

if (!fs.existsSync(sqliteFile)) {
  console.error(`SQLite file not found: ${sqliteFile}`);
  process.exit(1);
}

/**
 * The model map is intentionally dynamic: this script walks a table list, so
 * it is addressed by name rather than through generated property types.
 */
type Model = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
  deleteMany: () => Promise<unknown>;
};
type TargetClient = PrismaClient & Record<string, Model>;

const sqlite = new Database(sqliteFile, { readonly: true });
const target = new PrismaClient({
  adapter: new PrismaPg({ connectionString: targetUrl }),
}) as TargetClient;

/** Children first so foreign keys always resolve. */
const ORDER = [
  "Zone",
  "Area",
  "Package",
  "Role",
  "Permission",
  "RolePermission",
  "User",
  "Counter",
  "Setting",
  "SmsCredit",
  "Account",
  "Router",
  "Olt",
  "Onu",
  "Employee",
  "Customer",
  "CustomerPackageChange",
  "Invoice",
  "Payment",
  "Receipt",
  "Expense",
  "AccountTransfer",
  "AccountTransaction",
  "OnlineSession",
  "Ticket",
  "TicketComment",
  "Attendance",
  "Leave",
  "Salary",
  "Notification",
  "Backup",
  "ActivityLog",
];

/**
 * The clearing pass only has to satisfy foreign keys, which is a weaker
 * constraint than the insert order, so it simply empties every table in one
 * statement. `TRUNCATE ... CASCADE` also resets identity columns.
 */
async function clearTarget(client: TargetClient) {
  const names = ORDER.map((t) => `"${t}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

/**
 * SQLite has no distinct float type and no boolean type, so the driver hands
 * back numbers as REAL and flags as 0/1 integers. PostgreSQL is strict about
 * both, so each column type is normalised here. Keep these sets in step with
 * the schema when a column is added.
 */
const FLOAT_COLUMNS = new Set([
  "amount", "total", "paid", "vat", "discount", "monthlyPrice", "installationFee",
  "advancePayment", "previousDue", "totalPayable", "monthlyBill", "openingBalance",
  "currentBalance", "basic", "allowance", "bonus", "deduction", "advance",
  "netSalary", "fupLimit", "cpu", "ram",
]);

const BOOLEAN_COLUMNS = new Set(["isSystem", "isSecret", "isInternal", "useSsl"]);

/** ISO-8601 with an offset, which is what SQLite stores for DateTime columns. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function coerce(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      out[k] = null;
    } else if (BOOLEAN_COLUMNS.has(k)) {
      out[k] = v === 1 || v === "1" || v === true || v === "true";
    } else if (FLOAT_COLUMNS.has(k)) {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : 0;
    } else if (typeof v === "string" && ISO_DATE.test(v)) {
      // Prisma validates DateTime strictly on create, so hand it a real Date.
      out[k] = new Date(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Counter id, source table and the document-number column it tracks. */
const COUNTERS: [string, string, string][] = [
  ["customer", "Customer", "customerCode"],
  ["invoice", "Invoice", "invoiceNumber"],
  ["payment", "Payment", "paymentId"],
  ["receipt", "Receipt", "receiptNumber"],
  ["ticket", "Ticket", "ticketNumber"],
  ["transfer", "AccountTransfer", "reference"],
];

async function realignCounters(): Promise<{ id: string; value: number }[]> {
  const out: { id: string; value: number }[] = [];

  for (const [id, table, column] of COUNTERS) {
    const row = (
      await target.$queryRawUnsafe(
        `SELECT MAX(NULLIF(SUBSTRING("${column}" FROM '[0-9]+$'), '')::bigint) AS v FROM "${table}"`
      )
    ) as { v: bigint | null }[];
    const value = Number(row[0]?.v ?? 0);

    if (value === 0) {
      const [{ count }] = (await target.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM "${table}"`
      )) as { count: number }[];
      if (count > 0) {
        throw new Error(
          `Counter "${id}" could not be read from ${table}."${column}" — ` +
            `${count} rows exist but no number matched.`
        );
      }
    }

    await target.counter.upsert({ where: { id }, create: { id, value }, update: { value } });
    out.push({ id, value });
  }

  return out;
}

async function main() {
  const sourceTables = new Set(
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((r) => r.name)
  );

  console.log(`source : ${sqliteFile}`);
  console.log(`target : ${targetUrl}\n`);

  if (!process.argv.includes("--append")) {
    console.log("clearing the target database...");
    await clearTarget(target);
    console.log("");
  }

  const summary: { table: string; moved: number; skipped: number }[] = [];

  for (const table of ORDER) {
    if (!sourceTables.has(table)) {
      summary.push({ table, moved: 0, skipped: 0 });
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      summary.push({ table, moved: 0, skipped: 0 });
      continue;
    }

    const data = rows.map(coerce);
    let moved = 0;
    let skipped = 0;

    const model = target[table.charAt(0).toLowerCase() + table.slice(1)];

    // Batched inserts, falling back to row-by-row for a batch that fails so a
    // single bad record cannot take the rest of the table with it.
    const CHUNK = 50;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      try {
        await model.createMany({ data: slice });
        moved += slice.length;
      } catch {
        for (const row of slice) {
          try {
            await model.create({ data: row });
            moved += 1;
          } catch (e) {
            if (skipped === 1) {
              // Prisma's message names the offending argument with a `~`
              // marker; the lines around it are the useful part.
              const lines = (e instanceof Error ? e.message : String(e)).split("\n");
              const at = lines.findIndex((l) => l.includes("~"));
              const detail = lines
                .slice(Math.max(0, at - 1), at + 3)
                .map((l) => l.trim())
                .filter(Boolean)
                .join(" | ");
              console.log(`   ! ${table}: ${detail || lines[0]}`);
            }
            skipped += 1;
          }
        }
      }
    }

    summary.push({ table, moved, skipped });
  }

  console.log("transferred:");
  for (const s of summary.filter((x) => x.moved || x.skipped)) {
    const flag = s.skipped ? `  (${s.skipped} skipped)` : "";
    console.log(`  ${s.table.padEnd(24)} ${String(s.moved).padStart(6)}${flag}`);
  }

  // The SQLite counters are copied as-is, but they may be stale relative to the
  // rows that were actually moved (rows deleted, or a partial earlier run).
  // Re-derive them so the first document created after the migration cannot
  // collide with one that came across.
  const counters = await realignCounters();
  console.log(`\ncounters: ${counters.map((c) => `${c.id}=${c.value}`).join(", ")}`);

  // Sequential so the summary reads cleanly alongside the per-table counts.
  const customers = await target.customer.count();
  const invoices = await target.invoice.count();
  const payments = await target.payment.count();
  const accounts = await target.account.count();
  const txns = await target.accountTransaction.count();
  const tickets = await target.ticket.count();

  // Relational spot-checks: a migrated database must still be internally sound.
  const orphanPayments = await target.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM "Payment" p
     LEFT JOIN "Customer" c ON c.id = p."customerId"
     WHERE c.id IS NULL`
  ) as { c: bigint }[];
  const ledgerMismatch = await target.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM "AccountTransaction" t
     JOIN "Account" a ON a.id = t."accountId"
     WHERE t."balance" <> a."currentBalance" AND t.id = (
       SELECT id FROM "AccountTransaction" t2
       WHERE t2."accountId" = t."accountId"
       ORDER BY t2."date" DESC, t2.id DESC LIMIT 1
     )`
  ) as { c: bigint }[];

  console.log(
    `\nverified: ${customers} customers, ${invoices} invoices, ${payments} payments, ` +
      `${accounts} accounts, ${txns} ledger entries, ${tickets} tickets`
  );
  console.log(`  orphan payments : ${orphanPayments[0].c}`);
  console.log(`  ledger drift    : ${ledgerMismatch[0].c}`);

  const ok = Number(orphanPayments[0].c) === 0 && Number(ledgerMismatch[0].c) === 0;
  console.log(ok ? "\n✅ migration complete" : "\n⚠️  migrated, but verify the reported counts");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await target.$disconnect();
  });
