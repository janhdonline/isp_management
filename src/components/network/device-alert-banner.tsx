import Link from "next/link";
import { cn } from "@/lib/utils";

export type BannerAlert = {
  id: string;
  deviceType: string;
  deviceName: string;
  kind: string;
  openedAt: string;
  notifiedAt: string | null;
  notifyError: string | null;
};

/**
 * The open-outage banner on the dashboard.
 *
 * On the dashboard rather than only on Network, because the person who needs to
 * see it is usually not looking at the network page — they are looking at the
 * dashboard because they just logged in. A router that died overnight is not
 * something an operator should have to go and look for.
 *
 * Renders nothing at all when there is nothing wrong. A banner that is always
 * present gets ignored, which is the same failure as an alert channel nobody
 * reads.
 */
export function DeviceAlertBanner({
  count,
  alerts,
}: {
  count: number;
  alerts: BannerAlert[];
}) {
  if (count === 0) return null;

  const since = alerts.at(-1)?.openedAt;
  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-red-900 dark:text-red-200">
          {count} open device alert{count === 1 ? "" : "s"}
          {since ? ` · oldest ${relative(since)}` : ""}
        </p>
        <Link
          href="/network/alerts"
          className="text-xs font-medium text-red-800 underline hover:text-red-900 dark:text-red-300"
        >
          Open Network → Alerts
        </Link>
      </div>

      <ul className="mt-2 space-y-1">
        {alerts.map((a) => (
          <li key={a.id} className="text-xs text-red-800 dark:text-red-300">
            <span className="font-medium">{a.deviceType}</span>{" "}
            <span className="font-semibold">{a.deviceName}</span>{" — "}
            {a.kind === "Down" ? "unreachable" : a.kind === "LowSignal" ? "low signal" : a.kind}{" "}
            since {relative(a.openedAt)}
            {/*
              A page that failed to send is worth saying out loud: the operator is
              looking at a device that is genuinely down, and the absence of a
              notification is the thing that would mislead them into thinking
              somebody was already told.
            */}
            {a.notifyError ? (
              <span className="ml-1 opacity-80">· nobody was notified ({a.notifyError})</span>
            ) : null}
          </li>
        ))}
        {count > alerts.length ? (
          <li className="text-xs text-red-700 dark:text-red-400 opacity-80">
            …and {count - alerts.length} more.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Used by the Alerts page header so the two read the same. */
export function AlertCount({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "tnum text-sm font-semibold",
        count > 0 ? "text-red-600 dark:text-red-400" : "text-fg-muted"
      )}
    >
      {count}
    </span>
  );
}