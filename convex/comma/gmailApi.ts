/** One Google API call. Errors carry the status and Google's error code, never the token or the request body. */
export class GoogleApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Google answered ${status}: ${code}`);
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
    const body = (await response.json().catch(() => null)) as { error?: string | { status?: string; message?: string } } | null;
    const code = typeof body?.error === "string" ? body.error : body?.error?.status ?? `http_${response.status}`;
    throw new GoogleApiError(response.status, code);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}
