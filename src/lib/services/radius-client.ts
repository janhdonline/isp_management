/**
 * The RADIUS client, as the rest of the application sees it.
 *
 * `radius/disconnect.ts` sends Disconnect-Requests over UDP. It is plain Node —
 * no framework, no request context, no session — so it runs happily inside the
 * standalone process. But the code that *decides* to suspend a customer lives in
 * the Next.js app, and that must not reach into a `radius/` directory: `radius/` is
 * a process entry point, and a web bundle importing one drags `dgram` and the
 * codec into every server component.
 *
 * So the transport is here, in the service layer, and it is a small wrapper
 * rather than a reimplementation: the packet is encoded exactly as the RADIUS
 * process would, and the reply is verified the same way. One code path for
 * building a Disconnect-Request, so the two cannot disagree about the secret or
 * about what a valid acknowledgement looks like.
 */

import dgram from "node:dgram";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const radiusCodec = require_("radius");

/** RFC 5176 packet types. */
export const DISCONNECT_REQUEST = 40;
export const DISCONNECT_ACK = 41;
export const DISCONNECT_NAK = 42;
export const COA_REQUEST = 43;
export const COA_ACK = 44;
export const COA_NAK = 45;

const ACK_TIMEOUT_MS = 3_000;

export type DisconnectSessionResult = {
  acctSessionId: string;
  nasIp: string;
  ok: boolean;
  detail: string;
};

export type DisconnectOutcome = {
  ok: boolean;
  detail: string;
  sessions: DisconnectSessionResult[];
};

/**
 * Drops every live RADIUS session belonging to a subscriber.
 *
 * Called from Phase A when a customer on a RADIUS router is suspended. Zero live
 * sessions is a success: most suspended customers are not currently online, and
 * "there was nothing to disconnect" is the correct report — the next login is
 * refused by the auth handler regardless, because the database column is the
 * authority.
 */
export async function sendDisconnect(username: string): Promise<DisconnectOutcome> {
  const settings = await getSettings();
  const secret = settings["network.radiusSecret"] ?? "";
  // The *NAS's* CoA port, which is not the port this server listens on for CoA.
  // Conflating the two sends every Disconnect-Request to a listener that answers
  // "I do not act on CoA" and reports a live customer as still connected.
  const coaPort = Number(settings["network.nasCoaPort"]) || 3799;

  if (!secret) {
    return {
      ok: false,
      detail:
        "No RADIUS shared secret is set, so the live session was not disconnected. The line is still refused at the next login. Set it in Settings → Network.",
      sessions: [],
    };
  }

  const live = await prisma.radiusAccounting.findMany({
    where: { username, stoppedAt: null },
    select: { acctSessionId: true, nasIp: true },
  });

  if (!live.length) {
    return {
      ok: true,
      detail: `${username} has no live RADIUS session, so there was nothing to disconnect.`,
      sessions: [],
    };
  }

  const sessions: DisconnectSessionResult[] = [];
  for (const session of live) {
    sessions.push(await sendOne(username, session.acctSessionId, session.nasIp, secret, coaPort));
  }

  const failed = sessions.filter((s) => !s.ok);
  const ok = failed.length === 0;

  return {
    ok,
    detail: ok
      ? `Sent a Disconnect-Request for ${sessions.length} live session(s); the router acknowledged all of them.`
      : `Sent a Disconnect-Request for ${sessions.length} live session(s), but ${failed.length} did not acknowledge. The line is refused at the next login either way.`,
    sessions,
  };
}

/** One packet, one answer, with the transaction verified rather than assumed. */
function sendOne(
  username: string,
  acctSessionId: string,
  nasIp: string,
  secret: string,
  coaPort: number
): Promise<DisconnectSessionResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve({ acctSessionId, nasIp, ok, detail });
    };

    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(
      () => finish(false, `${nasIp} did not answer within ${ACK_TIMEOUT_MS / 1000}s`),
      ACK_TIMEOUT_MS
    );

    let request: Buffer;
    try {
      request = radiusCodec.encode({
        code: "Disconnect-Request",
        secret,
        identifier: Math.floor(Math.random() * 256),
        attributes: [
          ["User-Name", username],
          ["Acct-Session-Id", acctSessionId],
        ],
      });
    } catch (e) {
      return finish(false, `could not encode the request: ${e instanceof Error ? e.message : "unknown error"}`);
    }

    socket.on("error", (e) =>
      finish(false, `could not reach ${nasIp}: ${e instanceof Error ? e.message : "socket error"}`)
    );

    socket.on("message", (data) => {
      // A Disconnect-NAK is a real answer, not a parsing failure: the router
      // understood and declined, which usually means the session had already
      // ended. Reported as a failure of that session, with that reason.
      if (!radiusCodec.verify_response({ request, response: data, secret })) {
        return finish(false, `${nasIp} replied with a response that did not verify`);
      }
      const code = data.readUInt8(0);
      if (code === DISCONNECT_ACK) finish(true, `${nasIp} acknowledged the disconnect`);
      else if (code === DISCONNECT_NAK) finish(false, `${nasIp} refused — the session may already have ended`);
      // A CoA-ACK means something answered that is not a Disconnect-Request at
      // all. In practice it is this server's own CoA listener, which means the
      // send port is pointed at ourselves rather than at the router.
      else if (code === COA_ACK || code === COA_NAK) {
        finish(false, `${nasIp} replied with a CoA packet, not a Disconnect one — network.nasCoaPort is probably pointing at this server rather than the router.`);
      } else finish(false, `${nasIp} replied with an unexpected packet type ${code}`);
    });

    socket.send(request, coaPort, nasIp, (err) => {
      if (err) finish(false, `could not send to ${nasIp}: ${err.message}`);
    });
  });
}
