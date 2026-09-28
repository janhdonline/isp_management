import { type Prisma } from "@/generated/prisma/client";

export type SortDir = "asc" | "desc";

export type ListParams = {
  page?: number;
  perPage?: number;
  q?: string;
  sort?: string;
  dir?: SortDir;
  areaId?: string;
  zoneId?: string;
  packageId?: string;
  routerId?: string;
  oltId?: string;
  status?: string;
  connectionStatus?: string;
  billingStatus?: string;
  onlineStatus?: string;
  invoiceStatus?: string;
  method?: string;
  channel?: string;
  accountId?: string;
  category?: string;
  from?: string;
  to?: string;
  expiryFrom?: string;
  expiryTo?: string;
  minAmount?: string;
  maxAmount?: string;
  technicianId?: string;
  priority?: string;
  dueBucket?: "1-7" | "8-30" | "30+";
  /** Customer list only: restrict to rows whose expiry date is in the past. */
  expiredOnly?: boolean;
  columns?: string[];
};

export const DEFAULT_PER_PAGE = 10;
export const PER_PAGE_OPTIONS = [10, 25, 50, 100];

/** Narrows the raw searchParams object into a typed ListParams. */
export function parseListParams(
  sp: Record<string, string | string[] | undefined>
): ListParams {
  const one = (key: string): string | undefined => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    page: Number(one("page") ?? 1) || 1,
    perPage: Math.min(100, Number(one("perPage") ?? DEFAULT_PER_PAGE) || DEFAULT_PER_PAGE),
    q: one("q"),
    sort: one("sort"),
    dir: one("dir") === "asc" ? "asc" : "desc",
    areaId: one("areaId"),
    zoneId: one("zoneId"),
    packageId: one("packageId"),
    routerId: one("routerId"),
    oltId: one("oltId"),
    status: one("status"),
    connectionStatus: one("connectionStatus"),
    billingStatus: one("billingStatus"),
    onlineStatus: one("onlineStatus"),
    invoiceStatus: one("invoiceStatus"),
    method: one("method"),
    channel: one("channel"),
    accountId: one("accountId"),
    category: one("category"),
    from: one("from"),
    to: one("to"),
    expiryFrom: one("expiryFrom"),
    expiryTo: one("expiryTo"),
    minAmount: one("minAmount"),
    maxAmount: one("maxAmount"),
    technicianId: one("technicianId"),
    priority: one("priority"),
    dueBucket: one("dueBucket") as ListParams["dueBucket"],
  };
}

export function startOfDayParam(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
}

export function dateRange(
  from: string | undefined,
  to: string | undefined
): Prisma.DateTimeFilter | undefined {
  const gte = startOfDayParam(from);
  const lte = startOfDayParam(to, true);
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

export function amountFilter(min?: string, max?: string) {
  const lo = min ? Number(min) : undefined;
  const hi = max ? Number(max) : undefined;
  const gte = lo !== undefined && !Number.isNaN(lo) ? { gte: lo } : {};
  const lte = hi !== undefined && !Number.isNaN(hi) ? { lte: hi } : {};
  if (!Object.keys(gte).length && !Object.keys(lte).length) return undefined;
  return { ...gte, ...lte };
}

/** Case-insensitive contains across the given string fields. */
export function textSearch(fields: readonly string[], q?: string): Prisma.CustomerWhereInput | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: term } })) } as Prisma.CustomerWhereInput;
}

/** Standard response envelope so every DataTable renders states uniformly. */
export type ListResult<T> = {
  rows: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  /** Free text; each key is a field name supported by the current view. */
  csv: { headers: string[]; filename: string; rows: (string | number)[][] };
  metrics?: Record<string, number>;
};
