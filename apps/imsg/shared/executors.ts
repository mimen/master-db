import type { Platform } from "./types";

/**
 * Who runs a route's commands, and the status row it reports to Convex. A platform account's executor reports as
 * `<platform>:<accountId>`; model work reports as `ai`. Stored in `comma_bridge_state`.
 */

export const AI_STATUS_KEY = "ai";

export function accountStatusKey(platform: Platform, accountId: string): string {
  return `${platform}:${accountId}`;
}

/** The executor's name as the user knows it, for "Check the Mac mini connection". */
export const EXECUTOR_NAME: Readonly<Record<Platform, string>> = { imessage: "the Mac mini", slack: "Slack" };

/** The status row for a route's executor. A route from before accounts is its platform's only account's. */
export function routeStatus<T extends { key: string }>(rows: readonly T[], route: { platform: Platform; accountId?: string | null }): T | null {
  if (route.accountId) return rows.find((row) => row.key === accountStatusKey(route.platform, route.accountId!)) ?? null;
  const platformRows = rows.filter((row) => row.key.startsWith(`${route.platform}:`));
  return platformRows.length === 1 ? platformRows[0]! : null;
}
