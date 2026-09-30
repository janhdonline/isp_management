import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { buildCustomerWhere } from "./customers";
import { startOfDay, toCsv } from "@/lib/utils";

/**
 * BTRC subscriber reporting.
 *
 * Bangladeshi ISPs file a periodic subscriber report with the Bangladesh
 * Telecommunication Regulatory Commission. This module produces that return from
 * data the app already holds, and the whole design goal is that its numbers
 * cannot disagree with the dashboard: a regulator's figure that differs from the
 * operator's own screen is not a rounding difference, it is a submission that
 * gets queried.
 *
 * So nothing here counts subscribers with its own filters. Every cell is counted
 * through `buildCustomerWhere` — the same filter builder the Customers list
 * applies, and so the same predicate `customerStatusMetrics` uses behind the
 * dashboard cards. Two places that count the same thing with different predicates
 * is how a report starts lying; there is deliberately only one predicate, and
 * `tests/btrc.test.mjs` asserts the totals equal both those call sites.
 *
 * Read-only. Generating or exporting a report writes nothing.
 */

/** The connection statuses BTRC is told about, in reporting order. */
export const BTRC_STATUSES = ["Active", "Suspended", "Disconnected"] as const;

export type BtrcStatus = (typeof BTRC_STATUSES)[number];

/**
 * The CSV column layout — the single source of truth for it.
 *
 * ⚠️ CONFIRM BEFORE FIRST SUBMISSION: this layout is a reasonable reading of the
 * return, but it has NOT been checked against BTRC's currently prescribed
 * format, which is issued by the regulator and changes between filing periods.
 * Before a real return is filed, check every column name, its order and its
 * meaning against the current BTRC template, and change this constant (and
 * docs/BTRC_REPORT.md, which is asserted against it) to match. Do not reshape
 * the file by hand at export time — the point of the constant is that the export,
 * this file's docs and the test all describe the same layout.
 */
export const BTRC_COLUMNS = [
  "Package",
  "Area",
  "Active",
  "Suspended",
  "Disconnected",
  "Total Subscribers",
  "New Connections",
  "Churn",
] as const;

export const BTRC_FILENAME_PREFIX = "btrc-subscriber-report";

export type BtrcRow = {
  packageId: string | null;
  areaId: string | null;
  package: string;
  area: string;
  active: number;
  suspended: number;
  disconnected: number;
  /** The three statuses added up. Never a fourth, independent count. */
  total: number;
  /** Connected during the selected month. */
  newConnections: number;
  /** Disconnected during the selected month. */
  churn: number;
};

export type BtrcTotals = {
  active: number;
  suspended: number;
  disconnected: number;
  total: number;
  newConnections: number;
  churn: number;
  /** New connections minus churn for the month. */
  netChange: number;
};

export type BtrcReport = {
  /** `YYYY-MM`, or null when no valid month was selected. */
  month: string | null;
  /** Human label for the selected month, e.g. "September 2026". */
  label: string;
  rows: BtrcRow[];
  totals: BtrcTotals;
  csv: { headers: string[]; filename: string; rows: (string | number)[][] };
};

const EMPTY_TOTALS: BtrcTotals = {
  active: 0,
  suspended: 0,
  disconnected: 0,
  total: 0,
  newConnections: 0,
  churn: 0,
  netChange: 0,
};

/**
 * `YYYY-MM` → the half-open month as two Dates, or null when the input is not a
 * month.
 *
 * A missing or malformed month is null rather than a throw: the tab has to
 * render an empty report when nothing is selected, not an error page, because
 * "no month chosen" is a normal state of a month picker.
 */
export function monthRange(month: string | null | undefined): {
  month: string;
  from: Date;
  to: Date;
} | null {
  if (typeof month !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const index = Number(m[2]);
  if (index < 1 || index > 12) return null;
  const from = new Date(year, index - 1, 1);
  if (from.getFullYear() !== year || from.getMonth() !== index - 1) return null;
  // The first instant of the next month, less a millisecond, is the last instant
  // of this one.
  //
  // The arithmetic here is two near-identical subtractions, which is exactly why
  // it is worth spelling out. `index` is 1-based, so *this* month is `index - 1`.
  // The month argument of `new Date` is 0-based, so the *next* month is `index` —
  // not `index + 1`. Writing `index + 1` there makes the range end a whole month
  // late, and the failure is silent: every figure stays a plausible-looking
  // count, so the filed return just carries next month's connections and churn.
  // `tests/btrc.test.mjs` seeds an event in the month on each side to catch it.
  return {
    month,
    from: startOfDay(from),
    to: new Date(new Date(year, index, 1).getTime() - 1),
  };
}

/** The month the picker opens on when the URL carries no `month`. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string | null | undefined): string {
  const range = monthRange(month);
  if (!range) return "";
  return range.from.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * `connectionDate` inside the month, built by `buildCustomerWhere` rather than
 * written out, so "new connections this month" is the same predicate the
 * Customers list applies when a date range is typed into it.
 */
function monthConnectionFilter(range: { from: Date; to: Date }): Prisma.CustomerWhereInput {
  return buildCustomerWhere({ from: isoDate(range.from), to: isoDate(range.to) });
}

/** A `disconnectedAt` filter over one month, in the same shape as the above. */
function monthDisconnectFilter(range: { from: Date; to: Date }): Prisma.CustomerWhereInput {
  return {
    AND: [
      buildCustomerWhere({}),
      { disconnectedAt: { gte: range.from, lte: range.to } },
    ],
  };
}

type GroupKey = string;

const keyOf = (packageId: string | null, areaId: string | null): GroupKey =>
  `${packageId ?? ""}|${areaId ?? ""}`;

/**
 * The report for one month.
 *
 * `month` is the picker's `YYYY-MM`. Pass null (or anything unparseable) for an
 * empty report — every figure zero, no rows, and a CSV that is a header and
 * nothing else.
 */
export async function btrcReport(month: string | null | undefined): Promise<BtrcReport> {
  const range = monthRange(month);
  if (!range) {
    return {
      month: null,
      label: "",
      rows: [],
      totals: { ...EMPTY_TOTALS },
      csv: { headers: [...BTRC_COLUMNS], filename: btrcFilename(null), rows: [] },
    };
  }

  const [packages, areas] = await Promise.all([
    prisma.package.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.area.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const statusGroups = await Promise.all(
    BTRC_STATUSES.map((status) =>
      prisma.customer.groupBy({
        by: ["packageId", "areaId"],
        where: buildCustomerWhere({ status }),
        _count: { _all: true },
      })
    )
  );

  const [newGroups, churnGroups] = await Promise.all([
    prisma.customer.groupBy({
      by: ["packageId", "areaId"],
      where: monthConnectionFilter(range),
      _count: { _all: true },
    }),
    prisma.customer.groupBy({
      by: ["packageId", "areaId"],
      where: monthDisconnectFilter(range),
      _count: { _all: true },
    }),
  ]);

  const pkgName = new Map(packages.map((p) => [p.id, p.name]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));

  const index = (groups: { packageId: string | null; areaId: string | null; _count: { _all: number } }[]) => {
    const m = new Map<GroupKey, number>();
    for (const g of groups) m.set(keyOf(g.packageId, g.areaId), g._count._all);
    return m;
  };

  const [active, suspended, disconnected] = statusGroups.map(index);
  const newConnections = index(newGroups);
  const churn = index(churnGroups);

  // Every package/area pair that appears in any figure gets a row, including one
  // that holds nobody today but was connected to this month — a regulator asking
  // about churn in an area needs the row to exist for the answer to be "one".
  const keys = new Set<GroupKey>([
    ...active.keys(),
    ...suspended.keys(),
    ...disconnected.keys(),
    ...newConnections.keys(),
    ...churn.keys(),
  ]);

  const rows: BtrcRow[] = [...keys]
    .map((k) => {
      const [packageId, areaId] = k.split("|") as [string, string];
      const a = active.get(k) ?? 0;
      const s = suspended.get(k) ?? 0;
      const d = disconnected.get(k) ?? 0;
      return {
        packageId: packageId || null,
        areaId: areaId || null,
        package: packageId ? (pkgName.get(packageId) ?? "Unknown Package") : "No Package",
        area: areaId ? (areaName.get(areaId) ?? "Unknown Area") : "No Area",
        active: a,
        suspended: s,
        disconnected: d,
        total: a + s + d,
        newConnections: newConnections.get(k) ?? 0,
        churn: churn.get(k) ?? 0,
      };
    })
    .sort((x, y) => x.area.localeCompare(y.area) || x.package.localeCompare(y.package));

  const sum = (pick: (r: BtrcRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totals: BtrcTotals = {
    active: sum((r) => r.active),
    suspended: sum((r) => r.suspended),
    disconnected: sum((r) => r.disconnected),
    total: sum((r) => r.total),
    newConnections: sum((r) => r.newConnections),
    churn: sum((r) => r.churn),
    netChange: 0,
  };
  totals.netChange = totals.newConnections - totals.churn;

  return {
    month: range.month,
    label: monthLabel(range.month),
    rows,
    totals,
    csv: {
      headers: [...BTRC_COLUMNS],
      filename: btrcFilename(range.month),
      rows: rows.map(csvRow),
    },
  };
}

function csvRow(r: BtrcRow): (string | number)[] {
  // Column order comes from BTRC_COLUMNS, so the header and the values cannot
  // drift apart by someone reordering one of them.
  const values: Record<string, string | number> = {
    Package: r.package,
    Area: r.area,
    Active: r.active,
    Suspended: r.suspended,
    Disconnected: r.disconnected,
    "Total Subscribers": r.total,
    "New Connections": r.newConnections,
    Churn: r.churn,
  };
  return BTRC_COLUMNS.map((c) => values[c] ?? "");
}

export function btrcFilename(month: string | null | undefined): string {
  return month ? `${BTRC_FILENAME_PREFIX}-${month}.csv` : `${BTRC_FILENAME_PREFIX}.csv`;
}

/** The file itself, for the export endpoint. */
export function btrcCsv(report: BtrcReport): string {
  return toCsv(report.csv.headers, report.csv.rows);
}
