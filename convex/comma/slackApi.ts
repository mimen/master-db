/** One Slack Web API call. Errors carry the method and Slack's error code, never the token or the request. */
export class SlackApiError extends Error {
  constructor(readonly method: string, readonly code: string, readonly retryAfterSeconds?: number) {
    super(`Slack ${method} failed: ${code}`);
  }
}

export type SlackParams = Record<string, string | number | boolean | undefined>;

export async function slackApi<T>(method: string, params: SlackParams, token?: string): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, String(value));
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
  if (response.status === 429) throw new SlackApiError(method, "ratelimited", Number(response.headers.get("Retry-After") ?? "30"));
  if (!response.ok) throw new SlackApiError(method, `http_${response.status}`);
  const json = (await response.json()) as { ok: boolean; error?: string };
  if (!json.ok) throw new SlackApiError(method, json.error ?? "unknown_error");
  return json as T;
}
