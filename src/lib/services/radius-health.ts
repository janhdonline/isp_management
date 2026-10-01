/**
 * Is the RADIUS process alive?
 *
 * A UDP listener cannot be asked "are you up" — there is no connection, and a
 * request that never arrives is indistinguishable from a request that was
 * answered. So the process writes a heartbeat row every 15 seconds and the age of
 * that row *is* the answer. `HEARTBEAT_STALE_MS` is the threshold, and it is
 * four beats: long enough that a database hiccup or a slow write does not flap
 * the status, short enough that a killed process reads as DOWN well inside the
 * minute an operator is willing to wait before restarting it.
 *
 * This lives in the service layer rather than in the RADIUS process because the
 * dashboard needs it and the dashboard runs in Next.js, which has no business
 * importing a process entry point. The process imports it in turn — one
 * implementation, so the threshold cannot differ between what is written and what
 * is judged.
 */

export const HEARTBEAT_STALE_MS = 60_000;

/** The one row the process rewrites. */
export const HEARTBEAT_ID = "radius";

export type RadiusHealth = {
  /** False when the heartbeat is missing or older than the threshold. */
  running: boolean;
  packetsIn: number;
  packetsOut: number;
  startedAt: Date | null;
  /** Seconds since the last heartbeat, or null when the process has never run. */
  lastSeenSec: number | null;
  /** Packets per second, from the counter delta over `windowSec`. */
  packetsPerSec: number;
  windowSec: number;
};

export const DOWN_HEALTH: RadiusHealth = {
  running: false,
  packetsIn: 0,
  packetsOut: 0,
  startedAt: null,
  lastSeenSec: null,
  packetsPerSec: 0,
  windowSec: 0,
};

/**
 * A short history of heartbeat readings, in memory.
 *
 * A rate needs two readings and the previous row is gone by the time the page
 * renders, so the samples are kept here instead — keyed on `startedAt` so a
 * restarted process starts a fresh series rather than computing a rate across
 * two processes' counters, which would be a large negative or positive number
 * that reads as real traffic.
 */
const samples: { startedAt: number; at: number; packets: number }[] = [];

export function recordHeartbeatSample(packetsIn: number, packetsOut: number, startedAt: Date) {
  const now = Date.now();
  samples.push({ startedAt: startedAt.getTime(), at: now, packets: packetsIn + packetsOut });
  // A minute of history is plenty for a rate, and short enough that a
  // long-running process does not keep one entry per heartbeat forever.
  while (samples.length > 1 && now - samples[0].at > 60_000) samples.shift();
}

/** Clears the sample history. For tests, and for a process that has restarted. */
export function resetHeartbeatSamples() {
  samples.length = 0;
}

export function healthSnapshot(
  db: { packetsIn: number; packetsOut: number; updatedAt: Date; startedAt: Date } | null
): RadiusHealth {
  if (!db) return { ...DOWN_HEALTH };

  const ageMs = Date.now() - db.updatedAt.getTime();
  // A stale row is DOWN, not "the last known state". A RADIUS server that died
  // while the dashboard still shows a green dot is exactly the failure this
  // function exists to prevent, and softening it to amber would be reporting a
  // guess.
  const running = ageMs < HEARTBEAT_STALE_MS;

  const now = Date.now();
  const latest = samples[samples.length - 1];
  let packetsPerSec = 0;
  let windowSec = 0;
  if (latest && latest.startedAt === db.startedAt.getTime()) {
    const first = samples.find((s) => now - s.at <= 60_000) ?? latest;
    windowSec = (now - first.at) / 1000;
    if (windowSec > 0) packetsPerSec = Math.max(0, (latest.packets - first.packets) / windowSec);
  }

  return {
    running,
    packetsIn: db.packetsIn,
    packetsOut: db.packetsOut,
    startedAt: db.startedAt,
    lastSeenSec: Math.round(ageMs / 1000),
    packetsPerSec,
    windowSec,
  };
}
