/** Small date helpers that the formatters in `utils` do not cover. */

/** A new date the given number of minutes from now. */
export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
