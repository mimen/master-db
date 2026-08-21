const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const AGE_CAP_DAYS = 30;

/** Subtitle fragment for the queue header. Caps at 30d so a stale oldest chat cannot dominate. */
export function queueAgeLabel(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return "no open conversations";
  const hours = Math.max(1, Math.floor((now - timestamp) / HOUR_MS));
  if (hours < 24) return `oldest ${hours}h`;
  const days = Math.floor((now - timestamp) / DAY_MS);
  if (days > AGE_CAP_DAYS) return `oldest ${AGE_CAP_DAYS}d+`;
  return `oldest ${days}d`;
}
