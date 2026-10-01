/**
 * The shape every scheduled job reports.
 *
 * In its own module because a job's implementation may need the type while
 * `cron.ts` imports the job — declaring it there would make the two import each
 * other, and a circular import that happens to work today is a bug waiting for the
 * first refactor. `cron.ts` re-exports it, so callers keep one name.
 */
export type JobResult = {
  /** What the job did. Zero is a legitimate answer, not an error. */
  ran: number;
  /** What it deliberately did not do, and why. */
  skipped: string;
  /** Only when something went wrong. Absent means nothing worth waking anyone for. */
  note?: string;
};