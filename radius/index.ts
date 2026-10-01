/**
 * `npm run radius` — the standalone RADIUS process.
 *
 * A separate process from the web app, sharing only the database. It binds three
 * UDP ports, answers authentication, accounting and disconnect for every router
 * that has RADIUS switched on, and writes a heartbeat so the dashboard can say
 * whether it is alive. README has the systemd unit for production; in development
 * this runs beside `npm run dev`.
 *
 * Nothing here needs the Next.js runtime, which is the point: the AAA path does
 * not share a failure domain with the request that renders a customer's invoice.
 */

import { startServer } from "./server";
import { reapStaleSessions } from "./accounting";
import { radiusConfig, resetRateLimits } from "./packet";

/** How often sessions a router forgot to close are cleaned up. */
const REAP_INTERVAL_MS = 60_000;

async function main() {
  const config = await radiusConfig();

  // The allowlist is read from the database, and the process starts with the one
  // in Settings. An operator who adds a router does not have to restart anything
  // for it to be admitted, because the cache is short — but the *secret* is read
  // once, so a secret change does need a restart, and the banner says so.
  resetRateLimits();

  const server = await startServer({ config });

  const bind = (c: unknown) => (typeof c === "string" ? c : "0.0.0.0");
  const line = (s: string) => process.stdout.write(`${s}\n`);

  line("");
  line("  RADIUS server");
  line("  ─────────────────────────────────────────────────────────────");
  line(`  Listening    ${bind(config.server)}:${config.authPort}/udp   Access-Request`);
  line(`               ${bind(config.server)}:${config.accountingPort}/udp   Accounting-Request`);
  line(`               ${bind(config.server)}:${config.coaPort}/udp   CoA / Disconnect`);
  line(`  Shared secret set (${config.secret.length} characters) — a change in Settings needs a restart`);
  line(`  Log retention ${config.logRetentionDays} day(s)`);
  line("  NAS allowlist: routers in Network → Routers with RADIUS switched on");
  line("");
  line("  Ctrl-C to stop.");
  line("");

  const reaper = setInterval(() => {
    reapStaleSessions().catch(() => {
      // A failed reap is retried on the next tick; sessions are only reaped after
      // five idle minutes, so skipping one tick costs nothing.
    });
  }, REAP_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    line(`\n  ${signal} — closing the RADIUS listeners.`);
    clearInterval(reaper);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  process.stderr.write(
    `\n  RADIUS could not start: ${e instanceof Error ? e.message : String(e)}\n\n`
  );
  process.exit(1);
});
