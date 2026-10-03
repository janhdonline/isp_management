"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";
import { transferFunds, recordExpense, issueRefund } from "@/lib/services/billing-queries";
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

/* ------------------------------------------------------------------ */
/* Refund                                                              */
/* ------------------------------------------------------------------ */

const refundSchema = z.object({
  customerId: z.string().min(1, "Select a customer"),
  accountId: z.string().min(1, "Select the account to refund from"),
  amount: z.coerce.number().gt(0, "Enter an amount greater than zero"),
  reason: z.string().trim().min(3, "Give a reason for the refund"),
  paymentId: z.string().trim().optional(),
  date: z.coerce.date().optional(),
  note: z.string().trim().optional(),
});

export async function issueRefundAction(
  _prev: AcctFormState,
  formData: FormData
): Promise<AcctFormState> {
  // Refunds move money out of an account, so they are gated behind Approve
  // rather than Create — same reasoning as a restore.
  const session = await requirePermission("accounts.approve");
  const parsed = refundSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) {
      const k = i.path.join(".") || "_form";
      (errors[k] ??= []).push(i.message);
    }
    return { errors, formError: "Please fix the highlighted fields." };
  }

  try {
    const result = await issueRefund({
      ...parsed.data,
      paymentId: parsed.data.paymentId || null,
      userId: session.id,
    });
    revalidatePath("/accounts");
    revalidatePath("/accounts/history");
    revalidatePath("/customers");
    return {
      success: `Refunded ${round2(result.amount)} (ref ${result.reference}). The customer now owes ${round2(result.newDue)}.`,
    };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Refund failed" };
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

  // A blank password field means "leave it alone", not "set it to empty".
  //
  // Every secret input renders with `defaultValue=""` and a "Saved. Leave blank
  // to keep the current value." hint, but the action used to upsert whatever came
  // through — so saving the page to change one non-secret setting silently wiped
  // the RADIUS secret, the MikroTik password and every stored provider token. The
  // hint promised the opposite of what the code did, which is worse than no hint.
  const { isSecretKey, getSettings } = await import("@/lib/settings");
  const keep: { key: string; value: string }[] = [];
  const writes: { key: string; value: string }[] = [];
  for (const entry of entries) {
    if (entry.value !== "" || !(await isSecretKey(entry.key))) {
      writes.push(entry);
      continue;
    }
    const current = (await getSettings())[entry.key];
    // A blank field on a secret that was never set is a genuine "clear it".
    if (current) keep.push(entry);
  }

  await saveSettings(writes);
  if (!writes.length && !keep.length) return { formError: "Nothing to save." };
  revalidatePath("/settings");
  return { success: "Settings saved." };
}

export async function testSmsProviderAction(
  channel: string = "SMS"
): Promise<AcctFormState> {
  const session = await requirePermission("settings.edit");
  const { testConnection } = await import("@/lib/services/messaging");
  const result = await testConnection(channel);

  await logActivity(
    {
      action: "Test",
      entity: "Setting",
      entityId: `api.${channel.toLowerCase()}`,
      summary: `${channel} connection test: ${result.ok ? "ok" : "failed"} — ${result.message}`,
    },
    session.id
  );

  revalidatePath("/settings/api");
  return result.ok ? { success: result.message } : { formError: result.message };
}

export async function backupNowAction(): Promise<AcctFormState> {
  const session = await requirePermission("settings.edit");
  const { createBackup, pruneBackups } = await import("@/lib/services/backup");
  const { getSetting } = await import("@/lib/settings");

  const result = await createBackup("Manual");
  if (!result.ok) return { formError: result.error };

  // Apply the retention policy so the directory cannot grow without bound.
  const keep = Number(await getSetting("backup.retention", "7"));
  const pruned = await pruneBackups(Number.isFinite(keep) ? keep : 7);

  await logActivity(
    {
      action: "Backup",
      entity: "Backup",
      entityId: result.fileName,
      summary: `Manual backup ${result.fileName} (${result.format}) — ${result.sizeLabel}${pruned ? `, pruned ${pruned} old` : ""}`,
    },
    session.id
  );

  revalidatePath("/settings/backup");
  return {
    success: `Backup created: ${result.fileName} (${result.format}, ${result.sizeLabel})${
      pruned ? ` — pruned ${pruned} old backup(s)` : ""
    }.`,
  };
}

export async function restoreBackupAction(fileName: string): Promise<AcctFormState> {
  const session = await requirePermission("settings.approve");
  const { restoreBackup } = await import("@/lib/services/backup");

  const result = await restoreBackup(fileName);
  if (!result.ok) return { formError: result.error };

  await logActivity(
    {
      action: "Restore",
      entity: "Backup",
      entityId: fileName,
      summary: `Restored ${fileName} (${result.format}, ${result.rows} rows)`,
    },
    session.id
  );

  // A restore replaces data everywhere, so the whole shell has to re-read it.
  revalidatePath("/", "layout");
  return {
    success: `Restored ${fileName} — ${result.rows.toLocaleString()} rows back in (${result.format}). Sign in again if you were logged out.`,
  };
}

export async function testMikrotikAction(): Promise<AcctFormState> {
  const session = await requirePermission("settings.edit");
  const { getSettings } = await import("@/lib/settings");
  const s = await getSettings();
  if (!s["network.mikrotikPassword"]) {
    return { formError: "No MikroTik API password configured under Settings → Network." };
  }
  const { adapterForRouter } = await import("@/lib/services/network-adapter");
  const adapter = adapterForRouter({
    ipAddress: s["network.mikrotikApiHost"],
    apiPort: Number(s["network.mikrotikApiPort"] ?? 8728),
    apiUser: s["network.mikrotikUsername"] || null,
    apiSecret: s["network.mikrotikPassword"] || null,
    useSsl: s["network.mikrotikSsl"] === "true",
    sessionSource: s["network.mikrotikSessionSource"] === "hotspot" ? "hotspot" : "ppp",
  });
  const health = await adapter.health();
  await logActivity(
    { action: "Test", entity: "Setting", entityId: "network.mikrotik", summary: `MikroTik test: ${health.status}` },
    session.id
  );
  return health.status === "Online"
    ? { success: `Connected. CPU ${(health.cpu ?? 0).toFixed(1)}% · ${health.activeUsers ?? 0} active sessions.` }
    : { formError: `Unreachable${health.error ? `: ${health.error}` : ""}` };
}
