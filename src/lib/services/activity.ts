import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

export type ActivityInput = {
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
  meta?: Record<string, unknown>;
  /** Set when the action should also queue a customer SMS. */
  smsBody?: string;
};

async function requestInfo() {
  try {
    const h = await headers();
    return {
      ipAddress:
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        h.get("x-real-ip") ||
        undefined,
      userAgent: h.get("user-agent") ?? undefined,
    };
  } catch {
    return { ipAddress: undefined, userAgent: undefined };
  }
}

/** Structural type so both a transaction client and the root client fit. */
export type ActivityWriter = {
  activityLog: {
    create: (args: {
      data: {
        action: string;
        entity: string;
        entityId?: string | null;
        summary: string;
        meta?: string | null;
        actorId?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
      };
    }) => Promise<unknown>;
  };
};

/** Writes an audit row through an existing transaction (keeps it atomic). */
export function prismaLog(tx: ActivityWriter, input: ActivityInput, userId?: string) {
  return tx.activityLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      summary: input.summary,
      meta: input.meta ? JSON.stringify(input.meta) : null,
      actorId: userId,
    },
  });
}

/** Standalone write, used when there is no surrounding transaction. */
export async function logActivity(input: ActivityInput, userId?: string) {
  const info = await requestInfo();
  return prisma.activityLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      summary: input.summary,
      meta: input.meta ? JSON.stringify(input.meta) : null,
      actorId: userId,
      ...info,
    },
  });
}
