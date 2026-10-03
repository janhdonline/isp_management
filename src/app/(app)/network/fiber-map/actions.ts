"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";
import { parsePoints } from "@/lib/services/fiber";

export type FiberActionState = { success?: string; formError?: string };

/**
 * A route's points, as a textarea.
 *
 * `[{lat,lng},…]` rather than a list of fields: a route is drawn as a polyline and
 * edited as a line, and a form with one row per waypoint is a form where
 * re-ordering means deleting and retyping every row after the one you moved. The
 * value is still validated — through `parsePoints`, the same function the map
 * reads with, so what is accepted here is exactly what is drawable there.
 */
const routeSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
  points: z.string().trim().min(1, "A route needs at least one point"),
  oltId: z.string().trim().optional().or(z.literal("")),
  areaId: z.string().trim().optional().or(z.literal("")),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function saveFiberRouteAction(
  id: string | null,
  raw: Record<string, unknown>
): Promise<FiberActionState> {
  try {
    const session = await requirePermission("network.edit");
    const parsed = routeSchema.safeParse(raw);
    if (!parsed.success) {
      return { formError: parsed.error.issues[0]?.message ?? "Please check the route." };
    }
    const d = parsed.data;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(d.points);
    } catch {
      return { formError: "Points must be a JSON array of { lat, lng } objects." };
    }
    // The same parser the map uses, and its output is what gets stored rather than
    // the text that was typed. So a route that saves holds exactly the points
    // that can be drawn — the map never has to cope with a route this form
    // accepted and then failed to render.
    const points = parsePoints(parsedJson);
    if (points.length < 1) {
      return {
        formError:
          'No usable point in that list. Each entry needs numeric `lat` and `lng`, and (0, 0) is not a location.',
      };
    }

    const data = {
      name: d.name,
      points,
      oltId: d.oltId || null,
      areaId: d.areaId || null,
      note: d.note || null,
    };

    const route = id
      ? await prisma.fiberRoute.update({ where: { id }, data })
      : await prisma.fiberRoute.create({ data });

    await logActivity(
      {
        action: id ? "Update" : "Create",
        entity: "FiberRoute",
        entityId: route.id,
        summary: `${id ? "Updated" : "Recorded"} fiber route ${route.name} with ${
          points.length
        } waypoint(s)`,
      },
      session.id
    );

    revalidatePath("/network/fiber-map");
    return { success: `Route ${route.name} saved.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not save the route." };
  }
}

export async function deleteFiberRouteAction(id: string): Promise<FiberActionState> {
  try {
    const session = await requirePermission("network.edit");
    const route = await prisma.fiberRoute.delete({ where: { id } });
    await logActivity(
      {
        action: "Delete",
        entity: "FiberRoute",
        entityId: id,
        summary: `Deleted fiber route ${route.name}`,
      },
      session.id
    );
    revalidatePath("/network/fiber-map");
    return { success: `Route ${route.name} deleted.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not delete the route." };
  }
}

/**
 * Records where a device stands.
 *
 * Separate from any device form on purpose: the OLT and ONU tables are read-only
 * views of live hardware, and the person who knows where a cabinet stands is the
 * person standing in front of it with a phone. So the position is set from the
 * map, next to the thing being positioned.
 *
 * `(0, 0)` is refused for the reason it is never drawn: it is "not filled in" that
 * parsed as a number, and it is in the Gulf of Guinea.
 */
export async function setDevicePositionAction(
  kind: "olt" | "router" | "onu" | "area",
  id: string,
  lat: number,
  lng: number
): Promise<FiberActionState> {
  try {
    const session = await requirePermission("network.edit");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { formError: "Those coordinates are not on the globe." };
    }
    if (lat === 0 && lng === 0) {
      return { formError: "(0, 0) is not a location — it is how an empty field parses." };
    }

    // One branch per table rather than `prisma[table[kind]]`: the four clients
    // are different types, and a union of them is not callable. Four lines beat a
    // cast that would hide a future column rename.
    const where = { where: { id }, data: { latitude: lat, longitude: lng }, select: { name: true } };
    const row =
      kind === "olt"
        ? await prisma.olt.update(where)
        : kind === "router"
          ? await prisma.router.update(where)
          : kind === "onu"
            ? await prisma.onu.update(where)
            : await prisma.area.update(where);

    const entity = kind === "olt" ? "Olt" : kind === "router" ? "Router" : kind === "onu" ? "Onu" : "Area";

    await logActivity(
      {
        action: "Update",
        entity,
        entityId: id,
        summary: `Set the map position of ${row.name} to ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      },
      session.id
    );

    revalidatePath("/network/fiber-map");
    if (kind === "area") revalidatePath("/areas");
    return { success: `${row.name} positioned on the map.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not set the position." };
  }
}