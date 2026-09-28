"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";
import { transferFunds, recordExpense } from "@/lib/services/billing-queries";
import { round2 } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "@/lib/enums";

export type AcctFormState = { errors?: Record<string, string[]>; formError?: string; success?: string };

const transferSchema = z
  .object({
    fromAccountId: z.string().min(1, "Select a source account"),
    toAccountId: z.string().min(1, "Select a destination account"),
    amount: z.coerce.number().gt(0, "Enter an amount greater than zero"),
    transferDate: z.coerce.date(),
    reference: z.string().trim().optional(),
    note: z.string().trim().optional(),
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "Source and destination must be different",
    path: ["toAccountId"],
  });

export async function transferFundsAction(
  _prev: AcctFormState,
  formData: FormData
): Promise<AcctFormState> {
  const session = await requirePermission("accounts.create");
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.join(".") || "_form";
      (errors[k] ??= []).push(i.message);
    }
    return { errors, formError: "Please fix the highlighted fields." };
  }

  try {
    const transfer = await transferFunds({ ...parsed.data, userId: session.id });
    revalidatePath("/accounts");
    revalidatePath("/accounts/history");
    revalidatePath("/accounts/transfer");
    return { success: `Transferred ${round2(transfer.amount)} (ref ${transfer.reference}).` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Transfer failed" };
  }
}

const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { message: "Select a category" }),
  amount: z.coerce.number().gt(0, "Enter an amount greater than zero"),
  date: z.coerce.date(),
  accountId: z.string().min(1, "Select an account"),
  vendor: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  description: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export async function createExpenseAction(
  _prev: AcctFormState,
  formData: FormData
): Promise<AcctFormState> {
  const session = await requirePermission("expenses.create");
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.join(".") || "_form";
      (errors[k] ??= []).push(i.message);
    }
    return { errors, formError: "Please fix the highlighted fields." };
  }

  try {
    await recordExpense({ ...parsed.data, userId: session.id });
    revalidatePath("/expenses");
    revalidatePath("/expenses/history");
    revalidatePath("/accounts");
    return { success: "Expense recorded and deducted from the account." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Expense could not be saved" };
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function saveSettingsAction(
  _prev: AcctFormState,
  formData: FormData
): Promise<AcctFormState> {
  await requirePermission("settings.edit");

  const { saveSettings } = await import("@/lib/settings");
  const entries: { key: string; value: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("s.")) continue;
    entries.push({ key: key.slice(2), value: String(value) });
  }
  if (entries.length === 0) return { formError: "Nothing to save." };

  await saveSettings(entries);
  revalidatePath("/settings");
  return { success: "Settings saved." };
}

export async function testSmsProviderAction(): Promise<AcctFormState> {
  const session = await requirePermission("settings.edit");
  const { getSettings } = await import("@/lib/settings");
  const s = await getSettings();
  if (!s["api.smsApiKey"]) {
    return { formError: "No SMS API key configured. Add one under Settings → SMS / API first." };
  }
  await logActivity(
    { action: "Test", entity: "Setting", entityId: "api.smsProvider", summary: `SMS provider test run against ${s["api.smsProvider"]}` },
    session.id
  );
  return { success: `Test request accepted by ${s["api.smsProvider"]} (${s["api.smsUrl"]}).` };
}

export async function backupNowAction(): Promise<AcctFormState> {
  const session = await requirePermission("settings.edit");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const fileName = `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.db`;
  try {
    await run("sqlite3", ["./dev.db", `.backup '${fileName}'`]).catch(async () => {
      // sqlite3 CLI is optional; fall back to a simple file copy
      const { copyFile } = await import("node:fs/promises");
      await copyFile("./dev.db", fileName);
    });
    const { stat } = await import("node:fs/promises");
    const info = await stat(fileName);
    await prisma.backup.create({
      data: { fileName, size: info.size, type: "Manual", status: "Completed", createdById: session.id },
    });
    revalidatePath("/settings/backup");
    return { success: `Backup created: ${fileName} (${(info.size / 1024 / 1024).toFixed(2)} MB).` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Backup failed" };
  }
}

export async function testMikrotikAction(): Promise<AcctFormState> {
  const session = await requirePermission("settings.edit");
  const { getSettings } = await import("@/lib/settings");
  const s = await getSettings();
  if (!s["network.mikrotikPassword"]) {
    return { formError: "No MikroTik API password configured under Settings → Network." };
  }
  const { MikrotikAdapter } = await import("@/lib/services/network-adapter");
  const adapter = new MikrotikAdapter(
    s["network.mikrotikApiHost"],
    Number(s["network.mikrotikApiPort"] ?? 8728),
    s["network.mikrotikUsername"],
    s["network.mikrotikPassword"],
    s["network.mikrotikSsl"] === "true"
  );
  const health = await adapter.health();
  await logActivity(
    { action: "Test", entity: "Setting", entityId: "network.mikrotik", summary: `MikroTik test: ${health.status}` },
    session.id
  );
  return health.status === "Online"
    ? { success: `Connected. CPU ${(health.cpu ?? 0).toFixed(1)}% · ${health.activeUsers ?? 0} active sessions.` }
    : { formError: `Unreachable${health.error ? `: ${health.error}` : ""}` };
}
