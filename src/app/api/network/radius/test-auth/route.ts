import dgram from "node:dgram";
import { requirePermission, AuthError, ForbiddenError } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/services/activity";
import { loadDictionaries, radiusCodec } from "@/lib/services/radius-codec";

export const dynamic = "force-dynamic";

/**
 * Send a real Access-Request to the local RADIUS server, and report what came back.
 *
 *   POST /api/network/radius/test-auth   { username, password }
 *
 * This is the setup debugger. When a new router will not authenticate, the two
 * candidate causes are a wrong shared secret and a subscriber this app rejects —
 * and they look identical from the router's side, because both produce an
 * Access-Reject. Sending a packet from here and watching the result separates them
 * in seconds: a Reject whose reply arrived proves the secret matches and the
 * problem is the subscriber's state; no reply at all means the process is not
 * listening, the port is wrong, or the secret differs.
 *
 * Requires `network.edit`, not `network.view`: it is a credential-testing tool, and
 * someone who can read the network should not be able to test passwords against it.
 *
 * **The password is never echoed, logged or stored.** It goes into one UDP packet
 * and is gone; the response contains only what the server chose to return, and the
 * audit entry records the username and the outcome. A test-auth feature that kept
 * the password would be a password store with extra steps.
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requirePermission("network.edit");
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof ForbiddenError ? 403 : 403;
    return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
  }

  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = (body.username ?? "").trim().slice(0, 64);
  const password = (body.password ?? "").slice(0, 128);

  if (!username || !password) {
    return Response.json(
      { error: "A username and a password are both required." },
      { status: 400 }
    );
  }

  const settings = await getSettings();
  const secret = settings["network.radiusSecret"] ?? "";
  const authPort = Number(settings["network.radiusPort"]) || 1812;

  if (!secret) {
    return Response.json(
      {
        error:
          "No RADIUS shared secret is set, so no test packet can be built. Set it in Settings → Network first.",
      },
      { status: 400 }
    );
  }

  // The server's own NAS allowlist is the router table, and a packet from
  // 127.0.0.1 will not match any router. So the test is sent to the server and
  // the *server* still refuses it unless a router claims that address — which is
  // correct behaviour and exactly what the note below explains.
  const outcome = await sendAccessRequest(authPort, secret, username, password);

  await logActivity(
    {
      action: "Test",
      entity: "Router",
      summary: outcome.accepted
        ? `RADIUS test auth for ${username} was accepted (via 127.0.0.1:${authPort})`
        : `RADIUS test auth for ${username} was not accepted: ${outcome.detail}`,
    },
    session.id
  );

  return Response.json(
    {
      ...outcome,
      // Said plainly, because it is the most common reason a test "always fails"
      // on a server that is working perfectly.
      note:
        "This packet came from 127.0.0.1. The server only answers a NAS whose address " +
        "appears on a router with RADIUS switched on — if it dropped the packet, that is why.",
    },
    { headers: { "cache-control": "no-store" } }
  );
}

type TestResult = {
  accepted: boolean;
  code: string | null;
  replyMessage: string | null;
  rateLimit: string | null;
  sessionTimeout: number | null;
  detail: string;
  ms: number;
};

/** One packet, one reply, with a short timeout. */
function sendAccessRequest(
  port: number,
  secret: string,
  username: string,
  password: string
): Promise<TestResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (partial: Omit<TestResult, "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve({ ...partial, ms: Date.now() - started });
    };

    loadDictionaries();
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(
      () =>
        finish({
          accepted: false,
          code: null,
          replyMessage: null,
          rateLimit: null,
          sessionTimeout: null,
          detail: `No reply from 127.0.0.1:${port} within 3 seconds. The RADIUS process is probably not running, or the port does not match network.radiusPort.`,
        }),
      3000
    );

    let packet: Buffer;
    try {
      packet = radiusCodec.encode({
        code: "Access-Request",
        secret,
        attributes: [
          ["User-Name", username],
          ["NAS-IP-Address", "127.0.0.1"],
          // Plaintext: the dictionary marks User-Password `encrypt=1`, so the
          // codec applies the cipher itself, against the authenticator it writes
          // into this very packet. Encrypting it here first would encrypt it
          // twice and the server would reject a correct password.
          ["User-Password", password],
        ],
      });
    } catch (e) {
      return finish({
        accepted: false,
        code: null,
        replyMessage: null,
        rateLimit: null,
        sessionTimeout: null,
        detail: `Could not build the Access-Request: ${e instanceof Error ? e.message : "unknown error"}`,
      });
    }

    socket.on("error", (e) =>
      finish({
        accepted: false,
        code: null,
        replyMessage: null,
        rateLimit: null,
        sessionTimeout: null,
        detail: `Socket error: ${e instanceof Error ? e.message : "unknown error"}`,
      })
    );

    socket.on("message", (data) => {
      try {
        const reply = radiusCodec.decode({ packet: data, secret });
        if (!reply) {
          return finish({
            accepted: false,
            code: null,
            replyMessage: null,
            rateLimit: null,
            sessionTimeout: null,
            detail: "A reply arrived but did not decode. The server is running with a different shared secret.",
          });
        }
        const vs = reply.attributes?.["Vendor-Specific"];
        const accepted = reply.code === "Access-Accept";
        finish({
          accepted,
          code: reply.code ?? null,
          // The Reply-Message is this server's own, chosen from a fixed set. It
          // never contains the password.
          replyMessage: reply.attributes?.["Reply-Message"] ?? null,
          rateLimit: vs?.["Mikrotik-Rate-Limit"] ?? null,
          sessionTimeout: reply.attributes?.["Session-Timeout"] ?? null,
          detail: accepted
            ? "Accepted — the secret matches and this subscriber may be online."
            : `Rejected (${reply.code}). If a reply arrived, the shared secret is correct; the reason is on the RADIUS Live page, and for a subscriber it will be their account state rather than their password.`,
        });
      } catch {
        finish({
          accepted: false,
          code: null,
          replyMessage: null,
          rateLimit: null,
          sessionTimeout: null,
          detail:
            "The reply did not decode with the configured secret. The server is running but appears to be using a different shared secret.",
        });
      }
    });

    socket.send(packet, port, "127.0.0.1", (err) => {
      if (err) {
        finish({
          accepted: false,
          code: null,
          replyMessage: null,
          rateLimit: null,
          sessionTimeout: null,
          detail: `Could not send: ${err.message}`,
        });
      }
    });
  });
}