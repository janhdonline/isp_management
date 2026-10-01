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
 * Grants or withdraws this router's RADIUS opt-in.
 *
 * Requires `network.edit` rather than `network.view`, and is audit-logged,
 * because the switch decides where an ISP's authentication happens: with it on,
 * this app answers every PPPoE login for the subscribers behind this router, and
 * its suspension logic is what cuts them off.
 *
 * The wording on the log line matters — "useRadius" would not say what changed,
 * and an operator reading the audit trail in six months needs to know the router
 * started authenticating through here.
 */
export async function setRouterRadiusAction(
  id: string,
  enabled: boolean
): Promise<NetActionState> {
  try {
    const session = await requirePermission("network.edit");
    const { prisma } = await import("@/lib/prisma");
    const router = await prisma.router.findUnique({
      where: { id },
      select: { id: true, name: true, useRadius: true },
    });
    if (!router) return { formError: "That router no longer exists." };

    if (router.useRadius === enabled) {
      return { success: `Nothing to change — ${router.name} already ${enabled ? "uses" : "does not use"} RADIUS.` };
    }

    await prisma.router.update({ where: { id }, data: { useRadius: enabled } });
    // The NAS allowlist is cached in the RADIUS process for 15 seconds, and a
    // router that has just been enrolled would be refused for that long. Noted
    // rather than fixed from here: the cache lives in a different process, and
    // the worst case is one dropped packet on a router that is not logging in yet.
    await logActivity(
      {
        action: enabled ? "Enable" : "Disable",
        entity: "Router",
        entityId: id,
        summary: enabled
          ? `RADIUS turned on for ${router.name} — PPPoE logins for its subscribers are now answered by this application, and suspensions are enforced by CoA`
          : `RADIUS turned off for ${router.name} — its PPPoE logins are no longer answered by this application, and enforcement goes back to the RouterOS API`,
      },
      session.id
    );

    revalidatePath("/network");
    revalidatePath("/network/routers");
    revalidatePath(`/network/routers/${id}`);
    return { success: enabled ? "RADIUS is on." : "RADIUS is off." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not change the setting" };
  }
}
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
