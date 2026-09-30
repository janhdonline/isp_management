"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createReseller, updateReseller, deleteReseller } from "@/lib/services/resellers";

export type ResellerFormState = {
  success?: string;
  formError?: string;
  errors?: Record<string, string[]>;
  id?: string;
};

const schema = z.object({
  name: z.string().trim().min(2, "Enter a name"),
  phone: z.string().trim().optional(),
  areaId: z.string().optional(),
  // Kept as a string through the form and parsed here, so an empty box or a
  // decimal the user typed does not arrive as NaN.
  commissionPct: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0, "Cannot be negative").max(100, "Cannot exceed 100").optional()
  ),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) =>
  Object.fromEntries(issues.map((i) => [String(i.path[0]), [i.message]]));

export async function createResellerAction(
  _prev: ResellerFormState,
  formData: FormData
): Promise<ResellerFormState> {
  const session = await requirePermission("resellers.create");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues), formError: "Please fix the highlighted fields." };
  }

  try {
    const row = await createReseller({
      name: parsed.data.name,
      phone: parsed.data.phone || undefined,
      areaId: parsed.data.areaId || undefined,
      commissionPct: parsed.data.commissionPct ?? 0,
      status: parsed.data.status,
      userId: session.id,
    });
    revalidatePath("/resellers");
    return { success: `Reseller ${row.name} added.`, id: row.id };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not add the reseller" };
  }
}

export async function updateResellerAction(
  _prev: ResellerFormState,
  formData: FormData
): Promise<ResellerFormState> {
  const session = await requirePermission("resellers.edit");
  const id = String(formData.get("id") ?? "");
  if (!id) return { formError: "No reseller was given." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error.issues), formError: "Please fix the highlighted fields." };
  }

  try {
    const row = await updateReseller(id, {
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      areaId: parsed.data.areaId || null,
      commissionPct: parsed.data.commissionPct,
      status: parsed.data.status,
      userId: session.id,
    });
    revalidatePath("/resellers");
    revalidatePath(`/resellers/${id}`);
    return { success: `${row.name} updated.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not update the reseller" };
  }
}

export async function deleteResellerAction(id: string): Promise<{ error?: string }> {
  const session = await requirePermission("resellers.delete");
  try {
    await deleteReseller(id, session.id);
    revalidatePath("/resellers");
    redirect("/resellers");
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return { error: e instanceof Error ? e.message : "Could not delete the reseller" };
  }
}