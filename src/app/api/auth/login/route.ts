import { z } from "zod";
import { loginStep1 } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * The rightmost `x-forwarded-for` entry, which is the address the closest
 * proxy observed. The leftmost is client-supplied and would let a caller
 * rotate apparent addresses past the per-address limit.
 */
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
    return Response.json({ ok: false, error: "Invalid credentials payload" }, { status: 400 });
  }

  const result = await loginStep1(parsed.data.email, parsed.data.password, clientIp(request));

  if (!result.ok) {
    if (result.reason === "locked") {
      return Response.json(
        {
          ok: false,
          error: "Too many failed attempts. Try again shortly.",
          retryAfterSec: result.retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } }
      );
    }
    // The same answer for an unknown address and a wrong password, so the
    // endpoint cannot be used to discover which accounts exist.
    return Response.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
  }

  // A second factor is owed. **No cookie is set**: the client is told what to do
  // next and has nothing to browse with until it comes back with a code.
  if ("pending" in result) {
    return Response.json({ ok: false, needsSecondFactor: true, ...result.pending }, { status: 401 });
  }

  const { session } = result;
  return Response.json({
    ok: true,
    user: {
      id: session.id,
      name: session.name,
      email: session.email,
      role: session.role,
      permissions: session.permissions,
    },
  });
}
