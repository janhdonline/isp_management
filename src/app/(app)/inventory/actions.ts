"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import {
  createItem,
  updateItem,
  deleteItem,
  recordMovement,
  CATEGORIES,
  MOVEMENT_TYPES,
} from "@/lib/services/inventory";
import { getSettings } from "@/lib/settings";

export type FormState = {
  success?: string;
  formError?: string;
  errors?: Record<string, string[]>;
} & { id?: string };

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) =>
  Object.fromEntries(issues.map((i) => [String(i.path[0]), [i.message]]));

/** Prices are optional, so an empty box means "not priced" rather than zero. */
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().min(0, "Cannot be negative").optional()
);

const itemSchema = z.object({
  name: z.string().trim().min(2, "Enter a name"),
  sku: z.string().trim().min(2, "Enter a SKU"),
  category: z.enum(CATEGORIES, { message: "Choose a category" }),
  unit: z.string().trim().min(1, "Enter a unit").max(12, "That unit is too long").optional(),
  reorderLevel: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : Number(v)),
    z.number().int().min(0, "Cannot be negative").max(1_000_000, "That is implausibly many").default(0)
  ),
  unitPrice: optionalNumber,
});

export async function createItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requirePermission("inventory.create");
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: fieldErrors(parsed.error.issues),
      formError: "Please fix the highlighted fields.",
    };
  }

  try {
    const item = await createItem({ ...parsed.data, userId: session.id });
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${item.id}`);
    return { success: `${item.name} added. Receive stock to set the opening balance.`, id: item.id };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not add the item" };
  }
}

export async function updateItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requirePermission("inventory.edit");
  const id = String(formData.get("id") ?? "");
  if (!id) return { formError: "No item was given." };

  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: fieldErrors(parsed.error.issues),
      formError: "Please fix the highlighted fields.",
    };
  }

  try {
    const item = await updateItem({ id, ...parsed.data, userId: session.id });
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${item.id}`);
    return { success: `${item.name} updated.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not update the item" };
  }
}

/**
 * Records stock in, out, or a count.
 *
 * A count is expressed as what the shelf actually holds, not as a difference:
 * "there are 47" is a fact somebody can check, "minus 3" is arithmetic they have
 * to trust. The service converts it to a delta for the ledger.
 */
export async function movementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requirePermission("inventory.edit");
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) return { formError: "No item was given." };

  const type = String(formData.get("type") ?? "");
  const raw = formData.get("quantity");
  const quantity = Number(raw);

  if (!MOVEMENT_TYPES.includes(type as (typeof MOVEMENT_TYPES)[number])) {
    return { formError: "Choose whether stock is coming in, going out, or being counted." };
  }
  if (!Number.isFinite(quantity)) {
    return { formError: "Enter a quantity." };
  }

  try {
    const r = await recordMovement({
      itemId,
      type: type as (typeof MOVEMENT_TYPES)[number],
      quantity,
      note: String(formData.get("note") ?? "") || undefined,
      reference: String(formData.get("reference") ?? "") || undefined,
      userId: session.id,
    });

    revalidatePath("/inventory");
    revalidatePath(`/inventory/${itemId}`);

    if (r.noChange) {
      return { success: `The count matches the books, so nothing was recorded.` };
    }
    // A shelf that has just crossed its reorder level is worth saying out loud:
    // this is the moment the person who can order stock learns about it.
    return {
      success: r.lowStock
        ? `Recorded. ${r.item.name} is now at ${r.item.quantity} ${r.item.unit}, at or below its reorder level of ${r.item.reorderLevel}.`
        : `Recorded. ${r.item.name} is now at ${r.item.quantity} ${r.item.unit}.`,
    };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not record the movement" };
  }
}

export async function deleteItemAction(id: string): Promise<FormState> {
  const session = await requirePermission("inventory.delete");
  try {
    await deleteItem(id, session.id);
    revalidatePath("/inventory");
    redirect("/inventory");
  } catch (e) {
    // `redirect` throws its own control-flow signal, which must not be shown to
    // the operator as a failure.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return { formError: e instanceof Error ? e.message : "Could not delete the item" };
  }
}

export async function getCurrency(): Promise<string> {
  const s = await getSettings();
  return s["company.currency"] ?? "BDT";
}
