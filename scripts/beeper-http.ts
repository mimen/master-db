export const BEEPER_REQUEST_TIMEOUT_MS = 20_000;
export const BEEPER_ASSET_TIMEOUT_MS = 120_000;
export const CONVEX_REQUEST_TIMEOUT_MS = 30_000;
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120_000;

export type FetchImplementation = typeof fetch;

type RetryOptions = {
  attempts?: number;
  fetchImplementation?: FetchImplementation;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

export type BeeperAsset = {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
};

export function resolveBeeperAssetSource(
  mxcId: string,
  sourceUrl: string | undefined,
): string {
  return sourceUrl?.startsWith("mxc://") ? sourceUrl : mxcId;
}

export async function beeperFetch(
  baseUrl: string,
  token: string,
  path: string,
  fetchImplementation: FetchImplementation = fetch,
  timeoutMs = BEEPER_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return fetchImplementation(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function fetchBeeperAsset(
  baseUrl: string,
  token: string,
  sourceUrl: string,
  options: RetryOptions = {},
): Promise<BeeperAsset> {
  const attempts = options.attempts ?? 5;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? BEEPER_ASSET_TIMEOUT_MS;
  const path = `/assets/serve?url=${encodeURIComponent(sourceUrl)}`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await beeperFetch(
        baseUrl,
        token,
        path,
        fetchImplementation,
        timeoutMs,
      );
      if (!response.ok) {
        throw new Error(
          `Beeper asset ${response.status} ${response.statusText} for ${sourceUrl}`,
        );
      }
      if (!response.body) {
        throw new Error(`Beeper asset response had no body for ${sourceUrl}`);
      }

      return {
        body: response.body,
        contentLength: parseContentLength(response.headers.get("content-length")),
      };
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }

  throw new Error("unreachable");
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
