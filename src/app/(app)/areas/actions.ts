"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";
import { deleteArea, deleteZone } from "@/lib/services/areas";
import { areaSchema, zoneSchema, fieldErrors, type FieldErrors } from "@/lib/validators";

export type AreaFormState = {
  errors?: FieldErrors;
  formError?: string;
  success?: string;
};

/**
 * The coordinates a form posted, as a pair or as nothing.
 *
 * The picker's hidden fields are empty strings when no pin was dropped, and a
 * `Float` column will not take `""`. `(0, 0)` is refused for the same reason the
 * map refuses to draw it: it is an empty field that parsed as a number, and it is
 * in the Gulf of Guinea.
 */
function position(parsed: { latitude?: unknown; longitude?: unknown }): {
  latitude: number | null;
  longitude: number | null;
} {
  const lat = parsed.latitude;
  const lng = parsed.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { latitude: null, longitude: null };
  }
  if (lat === 0 && lng === 0) return { latitude: null, longitude: null };
  return { latitude: lat, longitude: lng };
}

export async function createAreaAction(raw: Record<string, unknown>): Promise<AreaFormState> {
  const session = await requirePermission("areas.create");
  const parsed = areaSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };

  const dup = await prisma.area.findFirst({
    where: { name: parsed.data.name, zoneId: parsed.data.zoneId || null },
  });
  if (dup) return { errors: { name: ["An area with this name already exists in that zone"] } };

  const { latitude, longitude, ...rest } = parsed.data;
  const area = await prisma.area.create({ data: { ...rest, ...position({ latitude, longitude }) } });
  await logActivity({ action: "Create", entity: "Area", entityId: area.id, summary: `Created area ${area.name}` }, session.id);
  revalidatePath("/areas");
  return { success: `Area ${area.name} created.` };
}

export async function updateAreaAction(id: string, raw: Record<string, unknown>): Promise<AreaFormState> {
  const session = await requirePermission("areas.edit");
  const parsed = areaSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };

  const { latitude, longitude, ...rest } = parsed.data;
  const area = await prisma.area.update({
    where: { id },
    data: { ...rest, ...position({ latitude, longitude }), zoneId: parsed.data.zoneId || null },
  });
  await logActivity({ action: "Update", entity: "Area", entityId: id, summary: `Updated area ${area.name}` }, session.id);
  revalidatePath("/areas");
  return { success: `Area ${area.name} updated.` };
}

export async function deleteAreaAction(id: string): Promise<AreaFormState> {
  try {
    const session = await requirePermission("areas.delete");
    await deleteArea(id, session.id);
    revalidatePath("/areas");
    return { success: "Area deleted." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Delete failed" };
  }
}

export async function createZoneAction(raw: Record<string, unknown>): Promise<AreaFormState> {
  const session = await requirePermission("areas.create");
  const parsed = zoneSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };

  const dup = await prisma.zone.findUnique({ where: { name: parsed.data.name } });
  if (dup) return { errors: { name: ["A zone with this name already exists"] } };

  const zone = await prisma.zone.create({ data: parsed.data });
  await logActivity({ action: "Create", entity: "Zone", entityId: zone.id, summary: `Created zone ${zone.name}` }, session.id);
  revalidatePath("/areas");
  revalidatePath("/areas/zones");
  return { success: `Zone ${zone.name} created.` };
}

export async function updateZoneAction(id: string, raw: Record<string, unknown>): Promise<AreaFormState> {
  const session = await requirePermission("areas.edit");
  const parsed = zoneSchema.safeParse(raw);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };

  const zone = await prisma.zone.update({ where: { id }, data: parsed.data });
  await logActivity({ action: "Update", entity: "Zone", entityId: id, summary: `Updated zone ${zone.name}` }, session.id);
  revalidatePath("/areas");
  revalidatePath("/areas/zones");
  return { success: `Zone ${zone.name} updated.` };
}

export async function deleteZoneAction(id: string): Promise<AreaFormState> {
  try {
    const session = await requirePermission("areas.delete");
    await deleteZone(id, session.id);
    revalidatePath("/areas");
    revalidatePath("/areas/zones");
    return { success: "Zone deleted." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Delete failed" };
  }
}
