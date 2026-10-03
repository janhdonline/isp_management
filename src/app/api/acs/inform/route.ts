import { timingSafeEqual } from "node:crypto";
import { recordInform, readTr069Settings } from "@/lib/services/tr069";
import { getSettings } from "@/lib/settings";

/**
 * TR-069 Inform — the ACS endpoint.
 *
 * An unconfigured ONU boots, finds an ACS, and posts here saying what it is. That
 * is the whole zero-touch mechanism: from this request the device is in the
 * database and a technician never has to log into it.
 *
 * ## This route creates rows, so its authentication is the interesting part
 *
 * It is the only route in the app reachable without a session that *writes*. It
 * is authenticated by a shared secret, and three things follow:
 *
 *  - **No secret configured means no Inform is accepted at all.** The route
 *    answers 503 and says why. An empty string is not a valid secret, and
 *    comparing an empty header against an empty setting would let anyone on the
 *    internet register devices.
 *  - **The comparison is constant-time.** The repo does not do this anywhere
 *    else — the cron route uses `!==` — and it should. A byte-at-a-time
 *    comparison of a shared secret is a timing oracle that can recover it one byte
 *    at a time, and this secret is the only thing between the internet and the
 *    right to add rows. The cost is two lines.
 *  - **A rejected Inform is logged, not silently dropped.** A device that cannot
 *    get in retries; knowing that it tried is the difference between "the ACS is
 *    wrong" and "the secret is wrong".
 *
 * The serial is authenticated *by the secret alone*. There is no per-device
 * credential, which is honest about what TR-069 deployment commonly looks like
 * and worth stating plainly: anyone holding the secret can claim to be any
 * device. The blast radius is bounded by `recordInform`, which refuses to change
 * an existing device — so the worst a caller with the secret can do is create new
 * ONU rows, not repoint live ones.
 *
 * ## Response codes mean something to the device
 *
 * 2xx is done. 4xx is "you are wrong, do not keep trying" — a bad secret will
 * never start working on its own. 5xx is "try again later", and a real CPE will.
 * Sending 200 to a failed request would leave a device that never learns it was
 * rejected.
 */

export async function POST(request: Request) {
  const settings = readTr069Settings(await getSettings());

  if (!settings.secret) {
    return Response.json(
      {
        error:
          "Zero-touch provisioning is not configured. Set tr069.acsSecret in Settings → Network (or ACS_SECRET in the environment) before any device can check in.",
      },
      { status: 503 }
    );
  }

  const presented = readSecret(request.headers);
  if (!secureEquals(presented, settings.secret)) {
    await reject(settings.secret ? "bad secret" : "not configured", presented ? "presented" : "none");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!settings.enabled) {
    return Response.json(
      {
        error:
          "Zero-touch provisioning is switched off in Settings → Network. A device told 5xx will retry; one told 2xx would never come back.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The Inform body was not JSON" }, { status: 400 });
  }

  const inform = normaliseInform(body);
  if (!inform) {
    return Response.json(
      { error: 'An Inform must carry a serial number as "serialNo"' },
      { status: 400 }
    );
  }

  try {
    const outcome = await recordInform(inform);
    return Response.json(
      {
        ok: true,
        onuId: outcome.onuId,
        serialNo: outcome.serialNo,
        created: outcome.created,
        status: outcome.status,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      {
        error: "The Inform could not be recorded",
        detail: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Reads the shared secret from either header a CPE might use.
 *
 * TR-069 deployments in the wild send it in `Authorization: Bearer …`, in a
 * `X-ACS-Secret` header, or as a query parameter. Accepting all three is not
 * generosity: a device whose firmware only does one of them is otherwise a
 * technician typing a serial into a form, which is the thing this phase removes.
 */
function readSecret(headers: Headers): string {
  const auth = headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return (headers.get("x-acs-secret") ?? "").trim();
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — which leaks only the length, and the length of a shared secret is not
 * the secret.
 */
function secureEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Normalises an Inform.
 *
 * Deliberately tolerant about field names (`serialNo` or `SerialNumber`,
 * `ponIndex` or `PONPort`) and strict about the one that matters. Real CPEs
 * disagree about all of these, and a device that has to be re-flashed because its
 * Inform used the wrong key name has not been saved any work.
 *
 * Returns `null` rather than throwing when there is no serial: that is a
 * malformed request and belongs in a 400, not a 500.
 */
function normaliseInform(body: unknown): {
  serialNo: string;
  vendor?: string | null;
  model?: string | null;
  oltId?: string | null;
  ponIndex?: string | null;
  uptimeSeconds?: number | null;
  ipAddress?: string | null;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const v = b[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  };

  const serialNo = pick("serialNo", "SerialNumber", "serial", "Serial");
  if (!serialNo) return null;

  return {
    serialNo,
    vendor: pick("vendor", "Vendor", "manufacturer", "Manufacturer"),
    model: pick("model", "Model", "product", "Product"),
    oltId: pick("oltId", "OLTID", "olt"),
    ponIndex: pick("ponIndex", "PONPort", "ponPort", "pon_index"),
    uptimeSeconds: pick("uptimeSeconds", "Uptime") ? Number(pick("uptimeSeconds", "Uptime")) : null,
    ipAddress: pick("ipAddress", "IPAddress", "ip", "IP"),
  };
}

/**
 * A rejected Inform is worth a line in the log.
 *
 * The reason is recorded, never the presented value: an attacker probing this
 * endpoint should not end up with their own guesses in our audit trail, and a
 * genuine device with a stale secret gets an operator who can see it tried.
 */
async function reject(reason: string, presented: string): Promise<void> {
  const { logActivity } = await import("@/lib/services/activity");
  await logActivity({
    action: "Reject",
    entity: "Onu",
    entityId: undefined,
    summary: `Rejected a TR-069 Inform (${reason}; ${presented.length} characters presented)`,
  });
}
