export interface WebhookPayload {
  url: string;
  token: string | null;
  body: unknown;
}

export interface DeliveryOpts {
  fetch?: typeof fetch;
  retries?: number;
  backoffMs?: number;
}

export interface DeliveryResult {
  delivered: boolean;
  attempts: number;
  finalStatus: number | null;
}

export async function deliverWebhook(
  payload: WebhookPayload,
  opts: DeliveryOpts = {},
): Promise<DeliveryResult> {
  const fetchFn = opts.fetch ?? fetch;
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 1000;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (payload.token) headers.Authorization = `Bearer ${payload.token}`;
  let attempts = 0;
  let finalStatus: number | null = null;
  for (let i = 0; i <= retries; i++) {
    attempts++;
    try {
      const res = await fetchFn(payload.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload.body),
      });
      finalStatus = res.status;
      if (res.ok) return { delivered: true, attempts, finalStatus };
    } catch {
      finalStatus = null;
    }
    if (i < retries) await new Promise((r) => setTimeout(r, backoff * 2 ** i));
  }
  return { delivered: false, attempts, finalStatus };
}
