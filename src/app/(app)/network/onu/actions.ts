"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  ONU_ACTIONS,
  requestOnuAction,
  previewOnuAction,
  type OnuAction,
} from "@/lib/services/onu-control";

export type OnuControlState = {
  success?: string;
  formError?: string;
  /** The preview the client should re-render after a refusal. */
  preview?: Awaited<ReturnType<typeof previewOnuAction>>;
};

/**
 * Remote ONU control, from the ONU row and the customer Equipment tab.
 *
 * `requirePermission("network.edit")` first, before anything is read or written.
 * The service layer also refuses the actions that need a second confirmation, so
 * the two checks are not the same check: the permission decides whether the
 * operator may act at all, and the confirmation decides whether they meant to act
 * *now*.
 */
export async function onuControlAction(
  _prev: OnuControlState,
  formData: FormData
): Promise<OnuControlState> {
  const serialNo = String(formData.get("serialNo") ?? "").trim();
  const action = String(formData.get("action") ?? "") as OnuAction;
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const confirmed = formData.get("confirmImpact") === "on";

  if (!serialNo) return { formError: "No device serial was supplied." };
  if (!ONU_ACTIONS.includes(action)) {
    return { formError: `Unknown action "${action}".` };
  }

  let session;
  try {
    session = await requirePermission("network.edit");
  } catch (e) {
    // A clean refusal, and the message an operator needs: they cannot do this,
    // rather than a stack trace or a blank button.
    return {
      formError:
        e instanceof Error && /permission/i.test(e.message)
          ? "You do not have permission to control network devices. This needs the network.edit permission."
          : "You must sign in to control a device.",
    };
  }

  const result = await requestOnuAction({
    serialNo,
    action,
    actorId: session.id,
    reason,
    confirmCustomerImpact: confirmed,
  });

  revalidatePath("/network/onu");
  revalidatePath("/network/olt");

  if (!result.ok) {
    // Send the preview back so the dialog can re-open showing what is actually
    // true — the OLT may have been unconfigured since the operator last looked.
    const preview = await previewOnuAction(serialNo, action);
    return { formError: result.detail, preview };
  }

  return { success: result.detail };
}

/** Used by the client to build the confirm dialog before anything is sent. */
export async function previewControlAction(serialNo: string, action: OnuAction) {
  return previewOnuAction(serialNo, action);
}