import { z } from "zod";
import { loginWithPassword } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid credentials payload" }, { status: 400 });
  }

  const session = await loginWithPassword(parsed.data.email, parsed.data.password);
  if (!session) {
    return Response.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
  }

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
