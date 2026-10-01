"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { KeyRound, Loader2 } from "lucide-react";

/**
 * Send a real Access-Request to the local RADIUS server and show what came back.
 *
 * This is the setup debugger, and it exists because the two things that stop a new
 * router from authenticating are indistinguishable from the router itself: a wrong
 * shared secret and a subscriber this app rejects both produce an Access-Reject.
 * Here, a reply that arrives proves the secret matches; no reply at all means the
 * process is not listening or the secret differs.
 *
 * **The password is not kept.** It is held in component state for exactly as long
 * as the request takes, sent in one UDP packet, and cleared — there is no
 * persistence, no `localStorage`, and it is never included in the request body of
 * anything else or written to the audit log. A tool for testing credentials that
 * stored them would be a password store with extra steps.
 *
 * The reply attributes are shown because the rate limit is the interesting one: it
 * is how the operator confirms this application is sending the package speed, not
 * the router falling back to a default.
 */
export function TestAuthPanel() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestAuthResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/network/radius/test-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await res.json();
      setResult(body as TestAuthResult);
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : "The request failed.",
      } as TestAuthResult);
    } finally {
      setBusy(false);
      // Cleared on the way out, not on success only — a failed attempt is exactly
      // when somebody corrects a typo and tries again.
      setPassword("");
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <details>
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4 text-brand-600" />
          Send a test auth
          <span className="text-xs font-normal text-fg-muted">
            — checks the shared secret and whether a subscriber may log in
          </span>
        </summary>

        <form onSubmit={submit} className="mt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-fg-subtle">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="rahim100"
                autoComplete="off"
                className="h-9 w-40 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-fg-subtle">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                className="h-9 w-44 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !username.trim() || !password}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              Send
            </button>
          </div>

          <p className="text-xs text-fg-muted">
            The password is sent in one UDP packet and never stored or logged. The
            packet comes from 127.0.0.1, which is not a router — if the server drops
            it, that is the NAS allowlist doing its job rather than a failure.
          </p>

          {result ? <TestAuthResultView result={result} /> : null}
        </form>
      </details>
    </div>
  );
}

type TestAuthResult = {
  error?: string;
  accepted?: boolean;
  code?: string | null;
  replyMessage?: string | null;
  rateLimit?: string | null;
  sessionTimeout?: number | null;
  detail?: string;
  ms?: number;
  note?: string;
};

function TestAuthResultView({ result }: { result: TestAuthResult }) {
  if (result.error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        {result.error}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        result.accepted
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      )}
    >
      <p className="font-semibold">
        {result.accepted ? "Access-Accept" : (result.code ?? "No reply")}{" "}
        {result.ms != null ? <span className="font-normal opacity-70">in {result.ms}ms</span> : null}
      </p>
      {result.detail ? <p className="mt-1">{result.detail}</p> : null}
      {result.replyMessage ? (
        <p className="mt-1">
          Reply-Message: <span className="font-mono">{result.replyMessage}</span>
        </p>
      ) : null}
      {result.rateLimit ? (
        <p className="mt-1">
          Mikrotik-Rate-Limit: <span className="font-mono">{result.rateLimit}</span>
        </p>
      ) : null}
      {result.sessionTimeout != null ? (
        <p className="mt-1">
          Session-Timeout: <span className="font-mono">{result.sessionTimeout}s</span>
        </p>
      ) : null}
      {result.note ? <p className="mt-1 opacity-80">{result.note}</p> : null}
    </div>
  );
}