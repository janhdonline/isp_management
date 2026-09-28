import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Atomic, gapless sequence generator for human readable document numbers
 * (invoice, payment, receipt, customer code...). Runs inside the caller's
 * transaction so numbers can never be duplicated.
 */
export async function nextNumber(
  tx: Prisma.TransactionClient | PrismaClient,
  key: string,
  prefix: string,
  padding = 6
): Promise<string> {
  const row = await tx.counter.upsert({
    where: { id: key },
    create: { id: key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}${String(row.value).padStart(padding, "0")}`;
}

export type Tx = Prisma.TransactionClient;
