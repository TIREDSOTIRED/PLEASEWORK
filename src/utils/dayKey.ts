/**
 * ONE shared local-date boundary utility for every user-facing "today" /
 * daily aggregation (ledger summaries, sales analytics).
 *
 * Ledger timestamps are stored as UTC ISO strings (`Date.toISOString()`).
 * They must NEVER be bucketed by slicing the UTC date substring: in UTC+3
 * (Damascus) the UTC date is the previous calendar day for every sale made
 * between local 00:00 and 02:59. All daily boundaries derive from the LOCAL
 * calendar day via local Date getters — no locale tricks, no UTC slicing.
 */

/** Local calendar day of an instant as 'YYYY-MM-DD'. Invalid/empty → ''. */
export function localDateKey(input: Date | string | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return '';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True when a record's timestamp falls on the given local calendar day. */
export function isSameLocalDay(timestamp: Date | string | number | null | undefined, dayKey: string): boolean {
  if (!dayKey) return false;
  const key = localDateKey(timestamp);
  return key !== '' && key === dayKey;
}

/** The user's local "today" as a YYYY-MM-DD key. */
export function todayLocalKey(): string {
  return localDateKey(new Date());
}
