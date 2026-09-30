"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";
import { routerHealth, disconnectUser } from "@/lib/services/network";

export type NetActionState = { success?: string; formError?: string };

/** Polls the device through its adapter and stores the reported health. */
export async function testRouterAction(id: string): Promise<NetActionState> {
  try {
    const session = await requirePermission("network.view");
    const { health, adapterName } = await routerHealth(id);
    await logActivity(
      { action: "Health Check", entity: "Router", entityId: id, summary: `Health check via ${adapterName}: ${health.status}` },
      session.id
    );
    revalidatePath("/network");
    revalidatePath(`/network/routers/${id}`);
    return {
      success:
        health.status === "Online"
          ? `Online · CPU ${(health.cpu ?? 0).toFixed(1)}% · RAM ${(health.ram ?? 0).toFixed(1)}%`
          : `Device unreachable${health.error ? `: ${health.error}` : ""}`,
    };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Health check failed" };
  }
}

export async function syncRouterAction(id: string): Promise<NetActionState> {
  return testRouterAction(id);
}

export async function disconnectUserAction(customerId: string): Promise<NetActionState> {
  try {
    const session = await requirePermission("network.edit");
    const customer = await disconnectUser(customerId);
    await logActivity(
      {
        action: "Disconnect",
        entity: "Customer",
        entityId: customerId,
        summary: `Session for ${customer.username} terminated`,
      },
      session.id
    );
    revalidatePath("/network");
    revalidatePath("/customers/online");
    return { success: `${customer.username} disconnected.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Disconnect failed" };
  }
}

/**
 * Grants or withdraws this app's permission to write PPP secrets on a router.
 *
 * Requires `network.edit` rather than `network.view`, and is audit-logged: this
 * is the switch that lets the system create and delete credentials on a piece of
 * hardware, so "who turned this on, and when" needs to be answerable later.
 */
export async function setRouterAutoProvisionAction(
  id: string,
  enabled: boolean
): Promise<NetActionState> {
  try {
    const session = await requirePermission("network.edit");
    const { prisma } = await import("@/lib/prisma");
    const router = await prisma.router.findUnique({
      where: { id },
      select: { id: true, name: true, autoProvision: true },
    });
    if (!router) return { formError: "That router no longer exists." };

    await prisma.router.update({ where: { id }, data: { autoProvision: enabled } });
    await logActivity(
      {
        action: enabled ? "Enable" : "Disable",
        entity: "Router",
        entityId: id,
        summary: enabled
          ? `Auto-provisioning turned on for ${router.name} — this app may now create, reprofile and delete PPP secrets on it`
          : `Auto-provisioning turned off for ${router.name} — no further secrets will be created, reprofiled or deleted there`,
      },
      session.id
    );

    revalidatePath("/network");
    revalidatePath("/network/routers");
    revalidatePath(`/network/routers/${id}`);
    return { success: enabled ? "Auto-provisioning is on." : "Auto-provisioning is off." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not change the setting" };
  }
}
