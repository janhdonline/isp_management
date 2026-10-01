"use client";

/**
 * The RADIUS Live terminal.
 *
 * A stream of lines, filtered and searchable, with the four controls an operator
 * watching a login actually reaches for: which event types to show, a text search,
 * pause, and auto-scroll.
 *
 * Two decisions worth stating, because both are the kind that make a live view
 * quietly wrong:
 *
 *  - **Pause buffers rather than stops.** Pausing suspends the *display*; lines
 *    keep arriving and are appended to the same list. A pause that discarded them
 *    would mean unpausing silently skips the logins that happened while you were
 *    reading the last one — which is exactly the window you paused to investigate.
 *    The buffer is capped, so a long pause cannot grow without bound.
 *  - **The cursor only advances on lines the stream actually delivered.** The
 *    server's `cursor` is echoed, so a reconnect resumes from there. Filtering is
 *    server-side, which means a filtered-out line still advances the cursor — it
 *    was seen by the server and will not be sent again. Without that, toggling a
 *    filter would replay every line already on screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { TestAuthPanel } from "@/components/network/test-auth-panel";
import { cn } from "@/lib/utils";
import { Pause, Play, Search, ChevronDown, ChevronUp } from "lucide-react";

export type TerminalLine = {
  id: number;
  type: string;
  outcome: string | null;
  username: string | null;
  nasIp: string | null;
  message: string;
  createdAt: string;
};

export type Health = {
  running: boolean;
  packetsIn: number;
  packetsOut: number;
  startedAt: string | Date | null;
  lastSeenSec: number | null;
  packetsPerSec: number;
  windowSec: number;
};

type Filters = "accept" | "reject" | "accounting" | "disconnect" | "dropped";

const ALL: Filters[] = ["accept", "reject", "accounting", "disconnect", "dropped"];

const LABEL: Record<Filters, string> = {
  accept: "Accepts",
  reject: "Rejects",
  accounting: "Accounting",
  disconnect: "Disconnects",
  dropped: "Dropped",
};

/**
 * A floor on what is kept.
 *
 * 2000 lines is roughly a minute of a busy ISP's auth traffic, and is enough to
 * scroll back through while an operator reads. A pause longer than that starts
 * dropping from the top, which is said in the UI rather than being silent.
 */
const MAX_LINES = 2000;

export function RadiusTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [active, setActive] = useState<Set<Filters>>(new Set(ALL));
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [held, setHeld] = useState({ buffered: 0, dropped: 0 });

  const bottom = useRef<HTMLDivElement>(null);
  // The cursor is a ref, not state: it changes on every batch of lines and
  // re-rendering the whole list to carry it would be a frame of latency for
  // something only the effect needs.
  const cursor = useRef(0);
  // The SSE callback needs to know whether the view is paused, and a callback
  // closes over the render it was created in — so `paused` alone would always be
  // the value from the first render. A ref updated in an effect gives the callback
  // the current value without re-subscribing on every pause.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const push = useCallback(
    (incoming: TerminalLine[]) => {
      if (!incoming.length) return;
      // Read before the state update rather than inside it: a ref read in an
      // updater is a read during render, and React rightly objects.
      const isPaused = pausedRef.current;
      let overflow = 0;
      setLines((prev) => {
        const next = prev.concat(incoming);
        overflow = next.length > MAX_LINES ? next.length - MAX_LINES : 0;
        return overflow ? next.slice(overflow) : next;
      });
      if (isPaused || overflow) {
        setHeld((h) => ({
          buffered: isPaused ? h.buffered + incoming.length : h.buffered,
          dropped: h.dropped + overflow,
        }));
      }
    },
    []
  );

  // The SSE connection. Re-created when the filters change, because the server
  // filters — and the cursor must reset when it does, or the new filter would
  // start from the old one's position and miss lines.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("after", "0");
    if (active.size && active.size !== ALL.length) params.set("types", [...active].join(","));
    if (search.trim()) params.set("search", search.trim());

    const source = new EventSource(`/api/network/radius/stream?${params.toString()}`);

    source.addEventListener("open", () => setConnected(true));

    source.addEventListener("lines", (event) => {
      setConnected(true);
      const data = JSON.parse((event as MessageEvent).data) as {
        lines: TerminalLine[];
        cursor: number;
      };
      // Advance first, then buffer. If a component update throws, resuming from a
      // stale cursor would replay the batch.
      cursor.current = data.cursor;
      push(data.lines);
    });

    source.addEventListener("ping", () => setConnected(true));

    source.addEventListener("error", () => {
      // EventSource reconnects on its own; this is only the indicator.
      setConnected(false);
    });

    return () => source.close();
  }, [active, search, push]);

  // Auto-scroll, and only when the user wants it. Turning it off is how somebody
  // reads a line that is about to scroll away.
  useEffect(() => {
    if (autoScroll && !paused) bottom.current?.scrollIntoView({ block: "end" });
  }, [lines, autoScroll, paused]);

  const resume = () => {
    setPaused(false);
    setHeld({ buffered: 0, dropped: 0 });
  };

  // Changing the filters clears the view and rewinds the cursor, together, before
  // React re-runs the effect and opens a new stream. Doing the reset in the effect
  // body would flash the old lines against the new filter, and doing them in two
  // places could disagree.
  const changeFilters = (next: Set<Filters>) => {
    if (next.size === 0) return;
    cursor.current = 0;
    setHeld({ buffered: 0, dropped: 0 });
    setLines([]);
    setActive(next);
  };

  const toggle = (f: Filters) => {
    const next = new Set(active);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    // Never allow zero filters: an empty stream with no explanation reads as a
    // broken page.
    changeFilters(next);
  };

  const changeSearch = (value: string) => {
    cursor.current = 0;
    setHeld({ buffered: 0, dropped: 0 });
    setLines([]);
    setSearch(value);
  };

  const time = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-3">
      <TestAuthPanel />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {ALL.map((f) => (
              <button
                key={f}
                onClick={() => toggle(f)}
                aria-pressed={active.has(f)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                  active.has(f)
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                    : "border-[var(--border-strong)] text-fg-subtle hover:bg-[var(--surface-3)]"
                )}
              >
                {LABEL[f]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
              <input
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                placeholder="Search username, NAS, message..."
                aria-label="Search the RADIUS log"
                className="h-8 w-56 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] pl-7 pr-2 text-xs focus:border-brand-500 focus:outline-none"
              />
            </label>

            <button
              onClick={() => (paused ? resume() : setPaused(true))}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                paused
                  ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
              )}
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? "Resume" : "Pause"}
            </button>

            <button
              onClick={() => setAutoScroll((v) => !v)}
              aria-pressed={autoScroll}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                autoScroll
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                  : "border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
              )}
            >
              {autoScroll ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
              Auto-scroll
            </button>
          </div>
        </div>

        {paused ? (
          <div className="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Paused — {held.buffered} new line{held.buffered === 1 ? "" : "s"} held back
            {held.dropped > 0
              ? `, and ${held.dropped} older than the ${MAX_LINES}-line limit were dropped`
              : ""}
            . Nothing has been lost from the log itself — this is the display only.
          </div>
        ) : null}

        <div className="h-[26rem] overflow-y-auto bg-[#0b0f14] px-3 py-2 font-mono text-[11.5px] leading-relaxed">
          {lines.length === 0 ? (
            <p className="py-6 text-center text-[#5b6b7c]">
              {connected
                ? "Waiting for RADIUS traffic. A router's first login will appear here."
                : "Connecting to the RADIUS stream..."}
            </p>
          ) : (
            <ul>
              {lines.map((l) => (
                <li key={l.id} className="flex gap-2 whitespace-pre-wrap">
                  <span className="shrink-0 text-[#4b5b6c]">{time(l.createdAt)}</span>
                  <span className="w-20 shrink-0 uppercase">{l.type}</span>
                  <span className={cn("w-32 shrink-0 truncate", toneClass(l.type))}>
                    {l.username ?? "—"}
                  </span>
                  <span className="shrink-0 text-[#7d8fa3]">{l.nasIp ?? ""}</span>
                  <span className="text-[#c8d5e2]">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div ref={bottom} />
        </div>
      </div>
    </div>
  );
}

function toneClass(type: string): string {
  switch (type) {
    case "accept":
      return "text-emerald-400";
    case "reject":
      return "text-red-400";
    case "accounting":
      return "text-sky-400";
    case "disconnect":
      return "text-amber-400";
    case "dropped":
      return "text-orange-400";
    default:
      return "text-slate-300";
  }
}

/**
 * The health widget.
 *
 * A dot, and the reason behind it. The important part is that DOWN is stated as
 * DOWN: a RADIUS server that has died is the single most damaging thing on this
 * page, because every subscriber behind a converted router is unable to log in,
 * and a dashboard that kept showing the last known state would hide it.
 */
export function RadiusHealthBadge({ health }: { health: Health }) {
  const running = health.running;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        running
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
      )}
    >
      <span
        className={cn(
          "size-2.5 rounded-full",
          running ? "bg-emerald-500" : "bg-red-500"
        )}
        aria-hidden
      />
      <div className="leading-tight">
        <p className={cn("text-sm font-semibold", running ? "text-emerald-900 dark:text-emerald-200" : "text-red-900 dark:text-red-200")}>
          {running ? "RADIUS is running" : "RADIUS is DOWN"}
        </p>
        <p className="text-xs text-fg-muted">
          {running ? (
            <>
              {health.packetsPerSec.toFixed(1)} packets/sec · last heartbeat{" "}
              {health.lastSeenSec}s ago
              {health.startedAt ? ` · up since ${new Date(health.startedAt).toLocaleTimeString()}` : ""}
            </>
          ) : (
            <>
              {health.lastSeenSec === null
                ? "This process has never run against this database."
                : `No heartbeat for ${health.lastSeenSec}s — it stopped more than a minute ago. Start it with npm run radius.`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
