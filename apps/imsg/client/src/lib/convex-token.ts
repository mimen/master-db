import { takeBootToken } from "./boot-handoff";

const RETRY_DELAYS_MS = [250, 750, 2000, 5000];

/**
 * The Mini's session token. Convex treats a null token as signed out and runs every
 * query unauthenticated, which throws on the first guarded read, so a Mini restart or
 * deploy blip is retried here before null is ever returned. The first unforced call
 * uses the request index.html already started, if any.
 */
export async function fetchAccessToken(
  baseUrl: string,
  { forceRefreshToken }: { forceRefreshToken: boolean },
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  takePrefetched: () => Promise<Response> | undefined = takeBootToken,
): Promise<string | null> {
  const prefetched = forceRefreshToken ? undefined : takePrefetched();
  if (prefetched) {
    const token = await readToken(prefetched);
    if (token !== null) return token;
  }
  for (let attempt = 0; ; attempt++) {
    const token = await readToken(fetcher(`${baseUrl}/api/convex-token${forceRefreshToken ? "?refresh=1" : ""}`));
    if (token !== null || attempt >= RETRY_DELAYS_MS.length) return token;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

async function readToken(request: Promise<Response>): Promise<string | null> {
  try {
    const response = await request;
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body !== null && typeof body === "object" && "token" in body && typeof body.token === "string"
      ? body.token : null;
  } catch {
    return null;
  }
}
