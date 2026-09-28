"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { packageSchema, fieldErrors, type FieldErrors } from "@/lib/validators";
import { logActivity } from "@/lib/services/activity";
import {
  deletePackage,
  duplicatePackage,
  togglePackageStatus,
} from "@/lib/services/packages";

export type PkgFormState = {
  errors?: FieldErrors;
  formError?: string;
  success?: string;
};

export async function createPackageAction(
  _prev: PkgFormState,
  formData: FormData
): Promise<PkgFormState> {
  const session = await requirePermission("packages.create");
  const parsed = packageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  const dup = await prisma.package.findUnique({ where: { name: parsed.data.name } });
  if (dup) return { errors: { name: ["A package with this name already exists"] } };

  const pkg = await prisma.package.create({ data: parsed.data });
  await logActivity(
    { action: "Create", entity: "Package", entityId: pkg.id, summary: `Created package ${pkg.name}` },
    session.id
  );

  revalidatePath("/packages");
  return { success: `Package ${pkg.name} created.` };
}

export async function updatePackageAction(
  id: string,
  _prev: PkgFormState,
  formData: FormData
): Promise<PkgFormState> {
  const session = await requirePermission("packages.edit");
  const parsed = packageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  const dup = await prisma.package.findFirst({ where: { name: parsed.data.name, id: { not: id } } });
  if (dup) return { errors: { name: ["A package with this name already exists"] } };

  const pkg = await prisma.package.update({ where: { id }, data: parsed.data });
  await logActivity(
    { action: "Update", entity: "Package", entityId: id, summary: `Updated package ${pkg.name}` },
    session.id
  );

  revalidatePath("/packages");
  revalidatePath(`/packages/${id}`);
  return { success: `Package ${pkg.name} updated.` };
}

export async function togglePackageStatusAction(id: string): Promise<PkgFormState> {
  try {
    const session = await requirePermission("packages.edit");
    const status = await togglePackageStatus(id, session.id);
    revalidatePath("/packages");
    revalidatePath(`/packages/${id}`);
    return { success: `Package set to ${status}.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Action failed" };
  }
}

export async function duplicatePackageAction(id: string): Promise<PkgFormState> {
  try {
    const session = await requirePermission("packages.create");
    const copy = await duplicatePackage(id, session.id);
    revalidatePath("/packages");
    return { success: `Duplicated as ${copy.name}.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Action failed" };
  }
}

export async function deletePackageAction(id: string): Promise<PkgFormState> {
  try {
    const session = await requirePermission("packages.delete");
    await deletePackage(id, session.id);
    revalidatePath("/packages");
    return { success: "Package deleted." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Delete failed" };
  }
}
