export function oauthCallbackCode(url: string): string | null {
  return new URL(url).searchParams.get("code") || null;
}
