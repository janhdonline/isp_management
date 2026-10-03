"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { assignOnuPort, suggestPort } from "@/lib/services/pon";

export type PonActionState = { success?: string; formError?: string };

/**
 * Places an ONU on a port, or explains why it cannot go there.
 *
 * The check is the service's, not this action's — `assignOnuPort` counts inside a
 * transaction that holds a lock on the cabinet, so the number it refuses on is the
 * number in the same transaction as the write. A check here would be a second
 * answer to the same question, taken a moment earlier, and it is the earlier one
 * that would be wrong.
 *
 * The permission check and the audit trail are here because this is a mutation an
 * operator performs on somebody's equipment, and both are cheap while the port is
 * still free.
 */
export async function assignPortAction(
  _prev: PonActionState,
  formData: FormData
): Promise<PonActionState> {
  try {
    const session = await requirePermission("network.edit");
    const onuId = String(formData.get("onuId") ?? "");
    const port = String(formData.get("port") ?? "");
    const slotRaw = String(formData.get("slot") ?? "").trim();
    const slot = slotRaw === "" ? undefined : Number(slotRaw);

    if (!onuId) return { formError: "Pick the ONU to place." };
    if (slot !== undefined && (!Number.isInteger(slot) || slot < 1)) {
      return { formError: "The ONU slot must be a whole number from 1 upwards." };
    }

    const result = await assignOnuPort({ onuId, port, slot, actorId: session.id });

    revalidatePath("/network/olt");
    revalidatePath(`/network/olt/${await oltIdFor(onuId)}`);
    revalidatePath("/network/pon-utilization");

    if (result.ok) {
      return { success: `Placed on port ${result.port}. That port now holds ${result.used} ONU(s).` };
    }

    // A refusal that names the alternative is not a dead end, so it goes back as a
    // message the operator can act on rather than as a bare error.
    // The alternative is named with its own numbers, because "port full" with no
    // next step is what makes an operator put the customer on hold.
    const used = result.suggestedUsed ?? 0;
    const free = result.suggestedFree ?? 0;
    const where = result.suggested
      ? ` Try ${result.suggested} instead — ${used} in use, ${free} slot(s) free.`
      : " No port on this cabinet has room; it needs another port, or a higher split ratio.";
    return { formError: result.reason + where };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not place the ONU." };
  }
}

/**
 * Returns the least-loaded port for a cabinet, for the form to show before
 * anything is submitted.
 *
 * Computed on demand and never held: the whole point is that it cannot go stale
 * between being shown and being used.
 */
export async function suggestPortForOlt(oltId: string) {
  return suggestPort(oltId);
}

async function oltIdFor(onuId: string): Promise<string> {
  const onu = await prisma.onu.findUnique({ where: { id: onuId }, select: { oltId: true } });
  return onu?.oltId ?? "";
}