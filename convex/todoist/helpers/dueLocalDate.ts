/**
 * The caller's calendar day (YYYY-MM-DD) for a Todoist `due.date`. All-day and floating dues already name
 * that day. A due with a fixed timezone arrives as a UTC instant ("...Z"), whose UTC date is the next day
 * for a Pacific evening, so it is shifted by the caller's offset first.
 *
 * @param timezoneOffsetMinutes Minutes to ADD to UTC to get local time (e.g., PST is -480)
 */
export function dueLocalDate(date: string, timezoneOffsetMinutes: number): string {
  if (!/T.*(Z|[+-]\d\d:?\d\d)$/.test(date)) return date.split("T")[0];
  return new Date(Date.parse(date) + timezoneOffsetMinutes * 60_000).toISOString().split("T")[0];
}
