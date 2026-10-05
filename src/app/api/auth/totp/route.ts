import { z } from "zod";
import { loginStep2 } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { requiresTotp } from "@/lib/services/totp";

/**
 * The second step of sign-in: the six-digit code, or a backup code, or the
 * confirmation of a new enrollment.
 *
 * Three things this endpoint will not do:
 *
 *  - **It will not issue a session without a valid second factor.** The challenge
 *    token is a capability for this one call and nothing else; it is only minted
 *    after a successful password comparison and it carries no permissions.
 *  - **It will not let a user past an enabled second factor by asking nicely.** A
 *    `kind: "enroll"` challenge is only ever minted for an account that does not
 *    have one enabled, and confirming it is what *creates* the requirement.
 *  - **It will not skip the rate limiter.** The same `LoginAttempt` budget, the
 *    same lockout, keyed on the account the challenge names — a six-digit code is a
 *    million times smaller a space than a password, so a second factor limited less
 *    harshly is not a second factor.
 */

const schema = z.object({
  token: z.string().min(10),
  code: z.string().min(1).max(64),
});

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1];
    return parts[0] ?? "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const result = await loginStep2(parsed.data.token, parsed.data.code, clientIp(request));

  if (!result.ok) {
    if (result.reason === "locked") {
      return Response.json(
        {
          ok: false,
          error: "Too many failed codes. Try again shortly.",
          retryAfterSec: result.retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } }
      );
    }
    // Deliberately vague. "Wrong code" and "wrong backup code" are the same answer,
    // because telling them apart tells an attacker which six-digit space is worth
    // attacking.
    return Response.json({ ok: false, error: "That code was not accepted" }, { status: 401 });
  }

  if ("pending" in result) {
    return Response.json({ ok: false, needsSecondFactor: true, ...result.pending }, { status: 401 });
  }

  const { session, method } = result;

  // A backup code was consumed, and the user needs to know *now* how many are left.
  // It is the only warning they get before they try to sign in somewhere new and
  // cannot.
  return Response.json({
    ok: true,
    method,
    user: {
      id: session.id,
      name: session.name,
      email: session.email,
      role: session.role,
      permissions: session.permissions,
    },
    ...(method === "backup"
      ? {
          backupCodeUsed: true,
          backupCodesRemaining:
            "backupRemaining" in result ? (result.backupRemaining as number) : null,
        }
      : {}),
  });
}

/**
 * Whether this sign-in is going to owe a second factor.
 *
 * Used by the sign-in form to label the second box before it is asked for, so a
 * user is not surprised by a step that did not exist a moment ago. It reports only
 * the policy, never a secret, and it is authenticated by the challenge token rather
 * than by a session — there is no session yet.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ ok: false, error: "Missing token" }, { status: 400 });

  const { readChallenge } = await import("@/lib/services/two-factor");
  const challenge = readChallenge(token);
  if (!challenge) return Response.json({ ok: false, error: "That sign-in attempt has expired" }, { status: 401 });

  const settings = await getSettings();
  return Response.json({
    ok: true,
    kind: challenge.kind,
    email: challenge.email,
    enforced: requiresTotp(null, settings["security.require2fa"] ?? ""),
  });
}
