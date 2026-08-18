export const DEFAULT_BEEPER_URL =
  "https://milads-mac-mini.taild31e9a.ts.net:8448/v1";

export function resolveBeeperUrl(configuredUrl: string | undefined): string {
  const trimmedUrl = configuredUrl?.trim();
  if (!trimmedUrl) return DEFAULT_BEEPER_URL;
  return trimmedUrl.replace(/\/+$/, "");
}
