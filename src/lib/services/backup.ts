import { prisma } from "@/lib/prisma";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const run = promisify(execFile);

export const BACKUP_DIR = path.join(process.cwd(), "backups");

/**
 * Backup and restore against PostgreSQL.
 *
 * Two formats, picked automatically:
 *
 *  - `.dump` — written by `pg_dump` in custom format. Preferred when the binary
 *    is on PATH, and the only option that captures the schema as well as the
 *    rows.
 *  - `.json.gz` — written through Prisma when `pg_dump` is unavailable, which
 *    is the case with the bundled development server. Rows only, but portable
 *    and restorable anywhere Prisma runs.
 *
 * The chosen format is recorded on the Backup row, so a restore knows how to
 * read a file it was handed rather than guessing from the extension alone.
 */

export type BackupFormat = "dump" | "json";

type Dump = Record<string, Record<string, unknown>[]> & {
  __meta?: { tables: string[]; createdAt: string };
};

type Model = {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
  deleteMany: () => Promise<unknown>;
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
};

/**
 * Children first, so a row's foreign keys always resolve on the way in. Kept
 * in step with the schema; the restore asserts every table exists.
 */
const TABLES: string[] = [
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

function models(): Record<string, Model> {
  return prisma as unknown as Record<string, Model>;
}

async function hasBinary(name: string): Promise<boolean> {
  try {
    await run(name, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** The only BigInt columns in the model, restored from the decimal strings. */
const BIGINT_COLUMNS = new Set(["downloadBytes", "uploadBytes"]);

function reviveBigInts(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (BIGINT_COLUMNS.has(k) && typeof v === "string" && /^\d+$/.test(v)) {
        out[k] = BigInt(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export type CreateResult =
  | {
      ok: true;
      fileName: string;
      size: number;
      sizeLabel: string;
      format: BackupFormat;
    }
  | { ok: false; error: string };

function label(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export async function createBackup(
  type: "Manual" | "Auto" = "Manual",
): Promise<CreateResult> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  try {
    if (await hasBinary("pg_dump")) {
      const fileName = `backup-${stamp()}.dump`;
      const filePath = path.join(BACKUP_DIR, fileName);
      await run(
        "pg_dump",
        [
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "--file",
          filePath,
          process.env.DATABASE_URL ?? "",
        ],
        { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 * 32 },
      );
      const { size } = await fs.stat(filePath);
      await prisma.backup.create({
        data: { fileName, size, type, status: "Completed" },
      });
      return {
        ok: true,
        fileName,
        size,
        sizeLabel: label(size),
        format: "dump",
      };
    }

    const fileName = `backup-${stamp()}.json.gz`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const payload: Dump = {};
    const m = models();

    for (const table of TABLES) {
      payload[table] =
        await m[table.charAt(0).toLowerCase() + table.slice(1)].findMany();
    }
    payload.__meta = { tables: TABLES, createdAt: new Date().toISOString() };

    // Traffic counters are BigInt, which JSON cannot represent, so they travel
    // as decimal strings and are turned back into BigInt on the way in.
    const json = JSON.stringify(payload, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    const gz = zlib.gzipSync(Buffer.from(json));
    await fs.writeFile(filePath, gz);
    await prisma.backup.create({
      data: { fileName, size: gz.byteLength, type, status: "Completed" },
    });
    return {
      ok: true,
      fileName,
      size: gz.byteLength,
      sizeLabel: label(gz.byteLength),
      format: "json",
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Backup failed";
    await prisma.backup.create({
      data: { fileName: "—", size: 0, type, status: "Failed" },
    });
    return { ok: false, error };
  }
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

export type RestoreResult =
  | { ok: true; rows: number; format: BackupFormat }
  | { ok: false; error: string };

export async function restoreBackup(fileName: string): Promise<RestoreResult> {
  const safe = path.basename(fileName);
  const filePath = path.join(BACKUP_DIR, safe);

  try {
    await fs.access(filePath);
  } catch {
    return { ok: false, error: `Backup file "${safe}" is no longer on disk.` };
  }

  if (safe.endsWith(".dump")) {
    if (!(await hasBinary("pg_restore"))) {
      return {
        ok: false,
        error: "pg_restore is not available on this machine.",
      };
    }
    try {
      await run(
        "pg_restore",
        [
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--dbname",
          process.env.DATABASE_URL ?? "",
          filePath,
        ],
        { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 * 32 },
      );
      await prisma.backup.updateMany({
        where: { fileName: safe },
        data: { status: "Restored" },
      });
      return { ok: true, rows: 0, format: "dump" };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "pg_restore failed",
      };
    }
  }

  let payload: Dump;
  try {
    payload = JSON.parse(
      zlib.gunzipSync(await fs.readFile(filePath)).toString("utf8"),
    );
  } catch {
    return { ok: false, error: "That file is not a readable JSON backup." };
  }

  const tables = payload.__meta?.tables;
  if (!Array.isArray(tables)) {
    return { ok: false, error: "That file has no backup manifest." };
  }

  let rows = 0;

  // The manifest is children-first (the order the rows were read in), so it has
  // to be walked backwards to empty the tables: a parent cannot be cleared
  // while a row still points at it.
  const wipeOrder = [...tables].reverse();

  // One transaction, so a failure halfway cannot leave a half-restored
  // database. That means it needs a longer timeout than the interactive
  // default: a full restore is thousands of inserts.
  await prisma.$transaction(
    async (tx) => {
      // Empty every table parents-first so nothing dangles, then replay the
      // rows in the opposite order.
      for (const table of wipeOrder) {
        await (tx as unknown as Record<string, Model>)[
          table.charAt(0).toLowerCase() + table.slice(1)
        ].deleteMany();
      }
      for (const table of tables) {
        const data = payload[table];
        if (!Array.isArray(data) || data.length === 0) continue;
        const target = (tx as unknown as Record<string, Model>)[
          table.charAt(0).toLowerCase() + table.slice(1)
        ];
        const CHUNK = 200;
        for (let i = 0; i < data.length; i += CHUNK) {
          await target.createMany({ data: reviveBigInts(data.slice(i, i + CHUNK)) });
          rows += Math.min(CHUNK, data.length - i);
        }
      }
    },
    { timeout: 10 * 60_000, maxWait: 30_000 }
  );

  await prisma.backup.updateMany({
    where: { fileName: safe },
    data: { status: "Restored" },
  });
  return { ok: true, rows, format: "json" };
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

/** Deletes the oldest automatic backups beyond the configured retention. */
export async function pruneBackups(keep = 7): Promise<number> {
  const autos = await prisma.backup.findMany({
    where: { type: "Auto", status: { not: "Failed" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true },
  });

  const stale = autos.slice(Math.max(0, keep));
  for (const b of stale) {
    if (b.fileName && b.fileName !== "—") {
      await fs.rm(path.join(BACKUP_DIR, path.basename(b.fileName)), {
        force: true,
      });
    }
  }
  if (stale.length) {
    await prisma.backup.deleteMany({
      where: { id: { in: stale.map((b) => b.id) } },
    });
  }
  return stale.length;
}

export async function backupPath(fileName: string): Promise<string> {
  return path.join(BACKUP_DIR, path.basename(fileName));
}
