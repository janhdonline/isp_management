import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | bigint | null | undefined, symbol = "৳") {
  const n = Number(value ?? 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol}${formatted}`;
}

export function formatNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-US");
}

export function formatBytes(bytes: number | bigint | null | undefined) {
  let n = Number(bytes ?? 0);
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  n = n / Math.pow(1024, i);
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)}, ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function formatTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatUptime(seconds: number | null | undefined) {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function daysBetween(from: Date, to: Date) {
  const a = new Date(from).setHours(0, 0, 0, 0);
  const b = new Date(to).setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

export function daysUntil(date: Date | null | undefined) {
  if (!date) return null;
  return daysBetween(new Date(), date);
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function addMonths(d: Date, months: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

export function relativeTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function paginate<T>(items: T[], page: number, perPage: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    items: items.slice((current - 1) * perPage, current * perPage),
    page: current,
    perPage,
    total,
    totalPages,
  };
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function csvEscape(value: unknown) {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}
