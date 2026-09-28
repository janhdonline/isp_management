"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, LoginState } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import * as React from "react";

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.formError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{state.formError}</p>
        </div>
      ) : null}

      <Field label="Email address" htmlFor="email" required error={state.errors?.email?.[0]}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="admin@isp.com"
          defaultValue={state.values?.email}
          invalid={!!state.errors?.email}
          autoFocus
        />
      </Field>

      <Field label="Password" htmlFor="password" required error={state.errors?.password?.[0]}>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            invalid={!!state.errors?.password}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle transition-colors hover:text-[var(--fg)]"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <SubmitButton />
    </form>
  );
}

export function LoginAside() {
  return (
    <div className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-fg lg:flex lg:flex-col lg:justify-between">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, #3163ff 0, transparent 45%), radial-gradient(circle at 80% 70%, #0ea5e9 0, transparent 45%)",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
            N
          </span>
          <div>
            <p className="text-sm font-semibold text-sidebar-active">NetLink Broadband</p>
            <p className="text-[11px] uppercase tracking-wider opacity-60">ISP Management System</p>
          </div>
        </div>

        <h2 className="mt-14 max-w-sm text-2xl font-semibold leading-snug text-sidebar-active">
          One operating system for your entire ISP.
        </h2>
        <p className="mt-3 max-w-sm text-sm leading-relaxed opacity-70">
          Customers, billing, accounts, network devices, support and reporting — connected end to
          end, not a pile of separate screens.
        </p>
      </div>

      <ul className="relative space-y-3.5 text-sm">
        {[
          ["Customer lifecycle", "Connection, activation, expiry, suspension and reconnection in one flow."],
          ["Billing engine", "Invoice, payment, due, receipt and account balance stay transactionally consistent."],
          ["Network adapters", "MikroTik, OLT and ONU integrations sit behind service adapters."],
          ["Audit trail", "Every financial and destructive action is logged with the acting user."],
        ].map(([title, desc]) => (
          <li key={title} className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-400" />
            <div>
              <p className="font-medium text-sidebar-active">{title}</p>
              <p className="text-xs opacity-65">{desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
