/**
 * PoD / CoA, for the RADIUS process.
 *
 * A Reject stops the *next* login. It does nothing about the customer who is
 * online right now, and the customer an office has just suspended is nearly
 * always online right now. So suspension has to end the live session, and
 * RFC 5176's Disconnect-Request is what ends it.
 *
 * The packet itself is built and its reply verified in exactly one place,
 * `src/lib/services/radius-client.ts`, because this file and Phase A's
 * enforcement code are the same operation viewed from two processes. Two
 * implementations would be free to disagree about the secret, the timeout or
 * what counts as an acknowledgement, and the disagreement would show up as a
 * suspension that reports success while the customer streams.
 *
 * Why that client lives in the service layer even though this process is the one
 * that speaks RADIUS: the code that *decides* to suspend lives in the Next.js app,
 * and a web bundle importing a `radius/` entry point would drag `dgram` and the
 * codec into every server component. The transport is a plain function, so both
 * processes can call it.
 */

import { sendDisconnect, type DisconnectOutcome } from "@/lib/services/radius-client";

/** RFC 5176 codes, re-exported because a reader of this file wants them. */
export const COA_CODE = "Disconnect-Request";
export const ACK_CODE = "Disconnect-ACK";
export const NAK_CODE = "Disconnect-NAK";

/**
 * Drops every live RADIUS session belonging to `username`.
 *
 * Accounting is what makes this possible: a Disconnect-Request has to name a NAS
 * and an `Acct-Session-Id`, and the only place either is known is the row the NAS
 * itself wrote while accounting. That is the reason accounting cannot be skipped —
 * without it there is nothing to address the packet to, and the customer stays
 * online while the system reports the suspension as delivered.
 *
 * Per-session results rather than one boolean: a subscriber with two sessions
 * across two NASes has had one cut and one not, and reporting that as a failure
 * sends a technician to the router that is already fine.
 */
export async function disconnectUser(username: string): Promise<DisconnectOutcome> {
  return sendDisconnect(username);
}

export type { DisconnectOutcome };
