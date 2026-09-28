import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { LoginForm, LoginAside } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const settings = await getSettings();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center bg-[var(--surface)] p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
                N
              </span>
              <div>
                <p className="text-sm font-semibold">{settings["company.name"] ?? "ISP Management"}</p>
                <p className="text-[11px] uppercase tracking-wider text-fg-subtle">ISP Management System</p>
              </div>
            </div>
          </div>

          <h1 className="text-xl font-semibold tracking-tight">Sign in to your account</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Enter your credentials to access the management console.
          </p>

          <div className="mt-7">
            <LoginForm />
          </div>

          <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
            <p className="text-xs font-semibold text-[var(--fg)]">Demo credentials</p>
            <dl className="mt-2 space-y-1 font-mono text-[11px] text-fg-muted">
              <div className="flex justify-between gap-3">
                <dt>Administrator</dt>
                <dd>admin@isp.com / admin123</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Account manager</dt>
                <dd>manager@isp.com / manager123</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Technician</dt>
                <dd>tech@isp.com / tech123</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <LoginAside />
    </div>
  );
}
