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
