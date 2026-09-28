"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const GRID = "var(--border)";
const MUTED = "var(--fg-muted)";

export type SeriesPoint = Record<string, string | number>;

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[];
  label?: string | number;
  formatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-lg">
      {label !== undefined ? (
        <p className="mb-1 text-xs font-semibold text-[var(--fg)]">{label}</p>
      ) : null}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="tnum ml-auto font-semibold text-[var(--fg)]">
            {formatter
              ? formatter(Number(p.value ?? 0), String(p.name))
              : Number(p.value ?? 0).toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

function Frame({ height = 260, children }: { height?: number; children: React.ReactElement }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  );
}

/* --- Line / area ------------------------------------------------------- */

export function TrendChart({
  data,
  series,
  xKey = "label",
  money = false,
  height,
}: {
  data: SeriesPoint[];
  series: { key: string; label: string; color?: string; type?: "line" | "area" }[];
  xKey?: string;
  money?: boolean;
  height?: number;
  stacked?: boolean;
}) {
  const fmt = (v: number) =>
    money
      ? `৳${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : v.toLocaleString();

  return (
    <Frame height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: MUTED }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: MUTED }}
          tickLine={false}
          axisLine={false}
          width={62}
          tickFormatter={(v) => (money ? `${Math.round(Number(v) / 1000)}k` : String(v))}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v, n) => fmt(v) + `  (${n})`} />}
          cursor={{ stroke: GRID }}
        />
        {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 6 }} /> : null}
        {series.map((s, i) =>
          s.type === "area" ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5 }}
            />
          )
        )}
      </LineChart>
    </Frame>
  );
}

/* --- Bar -------------------------------------------------------------- */

export function BarChartView({
  data,
  series,
  xKey = "label",
  money = false,
  height,
  stacked = true,
  horizontal = false,
}: {
  data: SeriesPoint[];
  series: { key: string; label: string; color?: string }[];
  xKey?: string;
  money?: boolean;
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
}) {
  const fmt = (v: number) =>
    money ? `৳${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v.toLocaleString();

  return (
    <Frame height={height}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, left: horizontal ? 8 : -12, bottom: 0 }}
        barCategoryGap={horizontal ? "22%" : "28%"}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} tickFormatter={(v) => (money ? `${Math.round(Number(v) / 1000)}k` : String(v))} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={104} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
            <YAxis tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={62} tickFormatter={(v) => (money ? `${Math.round(Number(v) / 1000)}k` : String(v))} />
          </>
        )}
        <Tooltip content={<ChartTooltip formatter={(v, n) => fmt(v) + `  (${n})`} />} cursor={{ fill: "var(--surface-3)" }} />
        {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 6 }} /> : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            stackId={stacked && series.length > 1 ? "1" : undefined}
            maxBarSize={horizontal ? 20 : 44}
          />
        ))}
      </BarChart>
    </Frame>
  );
}

/* --- Donut ------------------------------------------------------------ */

export function DonutChart({
  data,
  height = 260,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            content={
              <ChartTooltip
                formatter={(v, n) => `${v.toLocaleString()} (${total ? Math.round((v / total) * 100) : 0}%)  ${n}`}
              />
            }
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={2}
            stroke="var(--surface)"
            strokeWidth={2}
          >
            {data.map((d, i) => (
              <Cell key={d.label} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-xl font-semibold text-[var(--fg)]">{centerValue}</span>
          <span className="text-[11px] text-fg-muted">{centerLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ChartLegend({ data }: { data: { label: string; value: number; color?: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <ul className="mt-2 space-y-1.5">
      {data.map((d, i) => (
        <li key={d.label} className="flex items-center gap-2 text-xs">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
          <span className="truncate text-fg-muted">{d.label}</span>
          <span className="tnum ml-auto font-medium text-[var(--fg)]">{d.value.toLocaleString()}</span>
          <span className="tnum w-10 text-right text-fg-subtle">
            {Math.round((d.value / total) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export const CHART_COLORS = [
  "#3163ff",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
  "#14b8a6",
  "#a855f7",
  "#eab308",
  "#64748b",
];

export function ChartFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("w-full", className)}>{children}</div>;
}
