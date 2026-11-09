const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * Settings' countdown for a mailbox whose Google app is in Testing mode, where Google ends the grant 7 days after
 * consent. `reconnectBy` is listAccounts' time for it.
 */
export function reconnectCaption(reconnectBy: number, now: number): string {
  const left = reconnectBy - now;
  if (left <= 0) return "Google ended this week's access. Reconnect to keep reading.";
  if (left < DAY) {
    const hours = Math.ceil(left / HOUR);
    return `Reconnect within ${hours} ${hours === 1 ? "hour" : "hours"}, Google's weekly limit.`;
  }
  const days = Math.ceil(left / DAY);
  return `Reconnect within ${days} ${days === 1 ? "day" : "days"}, Google's weekly limit.`;
}

export const grantEnded = (reconnectBy: number | undefined, now: number): boolean => reconnectBy !== undefined && reconnectBy <= now;
