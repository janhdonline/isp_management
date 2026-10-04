/**
 * Proration for mid-cycle package changes (ISP.md §41).
 *
 * ## The problem
 *
 * Changing a customer's package used to swap `packageId` and `monthlyBill` and
 * stop. A customer who upgraded on the 20th of a 30-day cycle was billed as if
 * they had been on the new package for the whole month — so either they were
 * overcharged by ten days' difference, or the ISP quietly absorbed it and every
 * mid-month upgrade was a small loss that nobody could see.
 *
 * ## Why this module computes in integers
 *
 * Every money field in this application is a `Float`, because that is what was
 * there before. **That is a display and storage decision, not an arithmetic one.**
 * Floats cannot represent `166.67`, so `500 * 10 / 30` in JavaScript is
 * `166.66666666666669`, `round2` of which is `166.67` — right today — but the
 * same computation expressed as `(500/30) * 10` is `166.66666666666663`, and
 * `166.66666666666663 * 100` rounds to `16666` in some orders of operations and
 * `16667` in others. Whether an ISP is owed 166.66 or 166.67 should not depend on
 * how the expression was parenthesised.
 *
 * So the arithmetic here is on **integer poisha** (hundredths) from end to end,
 * with a single explicit rounding step at the end, and floats appear only when a
 * value is handed to the database. The acceptance figure for this phase is
 * *exactly* 166.67, and that is a claim about determinism rather than about
 * approximation.
 *
 * The rounding is **half away from zero**, symmetric for credits and charges, so
 * a downgrade is never the mirror of an upgrade by a poisha.
 */

/** Poisha in one unit of money. A taka is 100 poisha. */
export const POISHA = 100;

/**
 * A taka figure to integer poisha.
 *
 * `Math.round` rather than a multiply: `500.07 * 100` is `50006.99999999999` in
 * binary floating point, and flooring that gives 50006 — one poisha short, on
 * every amount with a fraction.
 */
export function toPoisha(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * POISHA);
}

/** Integer poisha back to a taka figure, for storage. */
export function fromPoisha(poisha: number): number {
  return poisha / POISHA;
}

/**
 * Divides in integers, rounding half away from zero.
 *
 * `Math.floor((2 * n + d) / (2 * d))` is the integer form of "divide and round
 * half away from zero", and it is exact: every value in it is an integer, so no
 * rounding happens before the one rounding that is intended.
 */
export function divRoundHalfAwayFromZero(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const negative = numerator < 0;
  const abs = Math.abs(numerator);
  const rounded = Math.floor((2 * abs + denominator) / (2 * denominator));
  return negative ? -rounded : rounded;
}

export type CycleWindow = {
  from: Date;
  to: Date;
  /** Whole days in the cycle. Never zero, and never negative. */
  days: number;
};

export type ProrationInput = {
  /** The old package's monthly price. */
  fromPrice: number;
  /** The new package's monthly price. */
  toPrice: number;
  /** The package validity in days, used when there is no invoice to align to. */
  validityDays: number;
  /** The latest invoice's cycle, when there is one. */
  cycle?: { from: Date; to: Date } | null;
  /** When the change happened. */
  changedAt: Date;
  fromName: string;
  toName: string;
};

export type Proration = {
  /** The window the change was prorated over. */
  cycle: CycleWindow;
  /** Whole days already served on the old package. */
  elapsedDays: number;
  /** Whole days remaining on the new one. */
  remainingDays: number;
  /** Price difference per month, in poisha. Negative for a downgrade. */
  differencePoisha: number;
  /** `differencePoisha / cycle.days`, in poisha. Negative for a downgrade. */
  dailyRatePoisha: number;
  /** What is owed (positive) or owed back (negative), in poisha. */
  adjustmentPoisha: number;
  /** The same figure as a taka amount, rounded to two places. */
  adjustment: number;
  direction: "upgrade" | "downgrade" | "none";
  /** Human-readable lines for the invoice note and the wallet reason. */
  lines: string[];
};

/** Whole days between two dates, truncated toward the earlier one. */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * The cycle a change falls in.
 *
 * Prefers the customer's latest invoice window, and falls back to the package's
 * validity period ending today. That is the same rule Phase F's usage measurement
 * uses (`cycleWindow` in `fup.ts`), deliberately: if FUP and proration disagreed
 * about where the month is, a customer near their limit would be prorated against
 * a different window from the one their usage was measured over.
 */
export function cycleFor(input: {
  validityDays: number;
  cycle?: { from: Date; to: Date } | null;
  now: Date;
}): CycleWindow {
  const from = input.cycle?.from ?? input.now;
  const to =
    input.cycle?.to ?? new Date(input.now.getTime() + (input.validityDays || 30) * 86_400_000);
  // A window that is a day or less, or inverted, has no days to prorate over.
  // Falling back to the package validity is better than dividing by something that
  // is not a month.
  const days = wholeDaysBetween(from, to);
  if (days >= 1) return { from, to, days };
  const fallbackFrom = input.now;
  const fallbackTo = new Date(input.now.getTime() + (input.validityDays || 30) * 86_400_000);
  return { from: fallbackFrom, to: fallbackTo, days: input.validityDays || 30 };
}

/**
 * Works out what a mid-cycle change is worth.
 *
 * `elapsedDays` is clamped to the window, so a change recorded outside it — a
 * backdated edit, a clock skew — prorates against the nearest real position in the
 * cycle rather than producing a negative or absurd number.
 */
export function prorate(input: ProrationInput): Proration {
  const cycle = cycleFor({
    validityDays: input.validityDays,
    cycle: input.cycle,
    now: input.changedAt,
  });

  const rawElapsed = wholeDaysBetween(cycle.from, input.changedAt);
  const elapsedDays = Math.max(0, Math.min(cycle.days, rawElapsed));
  const remainingDays = Math.max(0, cycle.days - elapsedDays);

  const differencePoisha = toPoisha(input.toPrice) - toPoisha(input.fromPrice);
  const dailyRatePoisha = divRoundHalfAwayFromZero(differencePoisha, cycle.days);
  const adjustmentPoisha = divRoundHalfAwayFromZero(differencePoisha * remainingDays, cycle.days);
  const adjustment = fromPoisha(adjustmentPoisha);

  const direction =
    adjustmentPoisha > 0 ? "upgrade" : adjustmentPoisha < 0 ? "downgrade" : "none";

  const taka = (poisha: number) => fromPoisha(poisha).toFixed(2);

  const lines = [
    "Package change, prorated over the rest of the billing cycle.",
    `From: ${input.fromName} — ${taka(toPoisha(input.fromPrice))} per month`,
    `To: ${input.toName} — ${taka(toPoisha(input.toPrice))} per month`,
    `Cycle: ${cycle.days} days, ${cycle.from.toISOString().slice(0, 10)} to ${cycle.to
      .toISOString()
      .slice(0, 10)}`,
    `Already served on the old package: ${elapsedDays} day(s)`,
    `Remaining on the new package: ${remainingDays} day(s)`,
    `Daily rate difference: ${taka(dailyRatePoisha)} per day`,
    `Adjustment: ${remainingDays} x ${taka(dailyRatePoisha)} = ${taka(adjustmentPoisha)}`,
  ];

  return {
    cycle,
    elapsedDays,
    remainingDays,
    differencePoisha,
    dailyRatePoisha,
    adjustmentPoisha,
    adjustment,
    direction,
    lines,
  };
}