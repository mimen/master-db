const RETRY_DELAYS_MS = [250, 750, 2000, 5000];

/**
 * The Mini's session token. Convex treats a null token as signed out and runs every
 * query unauthenticated, which throws on the first guarded read, so a Mini restart or
 * deploy blip is retried here before null is ever returned.
 */
export async function fetchAccessToken(
  baseUrl: string,
  { forceRefreshToken }: { forceRefreshToken: boolean },
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const token = await fetchOnce(baseUrl, forceRefreshToken, fetcher);
    if (token !== null || attempt >= RETRY_DELAYS_MS.length) return token;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

async function fetchOnce(baseUrl: string, forceRefreshToken: boolean, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(`${baseUrl}/api/convex-token${forceRefreshToken ? "?refresh=1" : ""}`);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body !== null && typeof body === "object" && "token" in body && typeof body.token === "string"
      ? body.token : null;
  } catch {
    return null;
  }
}
