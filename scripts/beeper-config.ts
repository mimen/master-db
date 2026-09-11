export const DEFAULT_BEEPER_URL =
  "https://milads-mac-mini.taild31e9a.ts.net:8448/v1";

export function resolveBeeperUrl(configuredUrl: string | undefined): string {
  const trimmedUrl = configuredUrl?.trim();
  if (!trimmedUrl) return DEFAULT_BEEPER_URL;
  return trimmedUrl.replace(/\/+$/, "");
}

/**
 * Apple Messages (iMessage, SMS, RCS) reaches Convex only through the imsg
 * server's identity sync. The Beeper mirror must never carry those threads,
 * so any bridge account that presents them is refused before a single chat
 * is fetched.
 */
export function beeperSyncAccountError(account: {
  accountID: string;
  network: string | null | undefined;
}): string | null {
  const network = (account.network ?? "").toLowerCase();
  if (network === "imessage" || /imessage|bluebubbles/i.test(account.accountID)) {
    return `refusing to mirror Apple Messages account "${account.accountID}" into Convex; iMessage, SMS, and RCS stay on the Mini behind the imsg API`;
  }
  return null;
}
