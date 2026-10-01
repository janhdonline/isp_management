"use client";

/**
 * The usage graph on a customer's profile.
 *
 * Bytes are converted from BigInt at the edge — once per day, here — and never
 * summed as JavaScript numbers anywhere upstream, so a customer who has moved
 * petabytes over the retention window still sees an exact total.
 */

import { useMemo, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { TrendChart } from "@/components/ui/charts";
import { SegmentedControl } from "@/components/ui/input";
import { formatBytes, formatNumber } from "@/lib/utils";

/**
 * Byte counts arrive as strings.
 *
 * A `bigint` cannot cross the server/client boundary — Next.js refuses to
 * serialise it — and the totals exceed 2^53 often enough on a busy line that a
 * `number` would quietly round them. So the server serialises to a decimal string
 * and the client reads it back into a BigInt for display.
 */
export type UsagePoint = {
  date: string;
  downloadBytes: string;
  uploadBytes: string;
  onlineMinutes: number;
  source: string;
};

export type UsageTotals = {
  downloadBytes: string;
  uploadBytes: string;
  onlineMinutes: number;
  peak: { date: string; downloadBytes: string; uploadBytes: string } | null;
  daysWithUsage: number;
};

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

export function UsageGraph({
  series,
  totals,
  packageSpeed,
}: {
  series: UsagePoint[];
  totals: UsageTotals;
  packageSpeed: number | null;
}) {
  const [range, setRange] = useState("30");

  const chart = useMemo(
    () =>
      series.map((d) => ({
        // "12 Oct" rather than an ISO date: a chart axis is read by eye, and an
        // ISO string repeated thirty times is a wall of digits.
        label: formatDay(d.date),
        // A Number here is for the axis only. The cards below read the exact
        // BigInt, so nothing a customer is shown is a rounded figure.
        Download: Number(d.downloadBytes),
        Upload: Number(d.uploadBytes),
      })),
    [series]
  );

  const downloadBytes = BigInt(totals.downloadBytes);
  const uploadBytes = BigInt(totals.uploadBytes);
  const hasUsage = downloadBytes + uploadBytes > 0n;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Download"
            value={formatBytes(downloadBytes)}
            tone="info"
            hint={totals.daysWithUsage > 0 ? `${totals.daysWithUsage} day(s) with traffic` : undefined}
          />
          <StatCard label="Upload" value={formatBytes(uploadBytes)} tone="success" />
          <StatCard
            label="Time online"
            value={`${formatNumber(totals.onlineMinutes)} min`}
            tone="neutral"
            hint="union of sessions, not their sum"
          />
          <StatCard
            label="Busiest day"
            value={totals.peak ? formatBytes(BigInt(totals.peak.downloadBytes) + BigInt(totals.peak.uploadBytes)) : "—"}
            tone="warning"
            hint={totals.peak ? formatDay(totals.peak.date) : "no traffic in this window"}
          />
        </div>
        <SegmentedControl
          name="usage-range"
          options={RANGES}
          value={range}
          onValueChange={(v) => setRange(v)}
        />
      </div>

      <Card>
        <CardHeader
          title="Daily usage"
          description={
            packageSpeed
              ? `Against a package of ${packageSpeed} Mbps`
              : "Recorded traffic for this customer"
          }
        />
        <CardBody>
          {hasUsage ? (
            <>
              <TrendChart
                data={chart}
                series={[
                  { key: "Download", label: "Download", type: "area", color: "#3163ff" },
                  { key: "Upload", label: "Upload", type: "area", color: "#10b981" },
                ]}
                height={260}
              />
              <p className="mt-2 text-[11px] text-fg-subtle">
                Aggregated nightly from MikroTik sessions and RADIUS accounting, whichever the
                day has. RADIUS wins where both exist — it is the router&apos;s own count and it
                is live, while a session row is only as current as the last sync.
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-fg-muted">
              No usage recorded in this window. Nothing here means nothing was measured — the
              next aggregation run fills it in.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/** "2026-10-12" → "12 Oct". Parsed by hand: `new Date` on an ISO date is UTC and can slip a day. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

/**
 * The panel a support agent sees on a "slow internet" ticket: what the customer
 * actually moved in the last week, next to what their line is supposed to do.
 *
 * The comparison is the point. "Your internet is slow" is unanswerable on its own;
 * "you moved 340 GB this week and were online 41 hours on a 10 Mbps line, which is
 * 95% of what that line can physically deliver" is either a congestion problem or
 * an expectation problem, and the two go to different people.
 */
export function UsageVsPackagePanel({
  totals,
  packageDownload,
  packageUpload,
  days = 7,
}: {
  totals: UsageTotals;
  packageDownload: number | null;
  packageUpload: number | null;
  days?: number;
}) {
  const downloadBytes = BigInt(totals.downloadBytes);
  const uploadBytes = BigInt(totals.uploadBytes);
  const totalBytes = downloadBytes + uploadBytes;

  // 95% of line rate is what a healthy line sustains in practice: TCP, PPPoE
  // framing and a contended uplink all take their cut, so a number above the
  // nominal speed is the signal, and one well below it is normal.
  const capacity = (mbps: number | null) =>
    mbps == null ? null : Number((mbps * 1_000_000) / 8) * 86400 * days * 0.95;

  const downCapacity = capacity(packageDownload);
  const upCapacity = capacity(packageUpload);
  const share = (used: bigint, cap: number | null) =>
    cap == null || cap === 0 ? null : Number(used) / cap;

  const downShare = share(downloadBytes, downCapacity);
  const upShare = share(uploadBytes, upCapacity);

  const hasUsage = totalBytes > 0n;

  return (
    <Card>
      <CardHeader
        title={`Last ${days} days of usage`}
        description={
          packageDownload
            ? `Against their ${packageDownload} Mbps package`
            : "This customer has no package speed on file"
        }
      />
      <CardBody className="space-y-3">
        {hasUsage ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UsageBar
                label="Download"
                used={downloadBytes}
                share={downShare}
                capacity={downCapacity}
                speed={packageDownload}
                color="#3163ff"
              />
              <UsageBar
                label="Upload"
                used={uploadBytes}
                share={upShare}
                capacity={upCapacity}
                speed={packageUpload}
                color="#10b981"
              />
            </div>
            <p className="text-xs text-fg-muted">
              Online for {formatNumber(totals.onlineMinutes)} minutes
              {totals.peak ? `, busiest day ${formatDay(totals.peak.date)}` : ""}.
              {downShare != null
                ? downShare > 0.9
                  ? " They are close to what the line can deliver — congestion or a shared segment, not the customer's equipment."
                  : downShare < 0.2
                    ? " They are well under the line — worth checking their own CPE and the configured sync speed before blaming the network."
                    : ""
                : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            No usage recorded in the last {days} days, so there is nothing here to compare
            against their package. That is itself worth noting: a customer complaining about
            speed with no recorded traffic may be disconnected rather than slow.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function UsageBar({
  label,
  used,
  share,
  capacity,
  speed,
  color,
}: {
  label: string;
  used: bigint;
  share: number | null;
  capacity: number | null;
  speed: number | null;
  color: string;
}) {
  const pct = share == null ? null : Math.min(100, share * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <span className="tnum text-sm font-semibold">{formatBytes(used)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct ?? 0}%`, background: color }}
        />
      </div>
      <p className="mt-1 text-[11px] text-fg-subtle">
        {pct == null ? "—" : `${pct.toFixed(0)}% of the line`}
        {capacity != null ? ` · about ${formatBytes(BigInt(Math.round(capacity)))} possible` : ""}
        {speed != null ? ` at ${speed} Mbps` : ""}
      </p>
    </div>
  );
}