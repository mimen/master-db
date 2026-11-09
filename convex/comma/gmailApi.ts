/** One Google API call. Errors carry the status and Google's error code, never the token or the request body. */
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

export class GoogleApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly reason?: string) {
    super(`Google answered ${status}: ${code}${reason ? ` (${reason})` : ""}`);
  }

  /** Gmail reports its per-user rate limit as a 403 PERMISSION_DENIED with a rate-limit reason, not only as a 429. */
  get rateLimited() {
    return this.status === 429 || (this.status === 403 && (this.code === "RESOURCE_EXHAUSTED" || RATE_LIMIT_REASONS.has(this.reason ?? "")));
  }
}

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type Init = { token?: string; method?: "GET" | "POST"; form?: Record<string, string>; json?: unknown };

export async function googleApi<T>(url: string, { token, method = "GET", form, json }: Init = {}): Promise<T> {
  const response = await fetch(url, {
    method: form || json !== undefined ? "POST" : method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(form ? { body: new URLSearchParams(form) } : json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string | { status?: string; errors?: { reason?: string }[] } } | null;
    const error = body?.error;
    const code = typeof error === "string" ? error : error?.status ?? `http_${response.status}`;
    throw new GoogleApiError(response.status, code, typeof error === "string" ? undefined : error?.errors?.[0]?.reason);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}
