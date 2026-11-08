import { vi } from "vitest";

/**
 * A fake Google behind `fetch`, for Convex tests: OAuth's token and revoke endpoints and the Gmail API calls Comma
 * makes, for one mailbox. It checks the bearer token and records every call. The name has two dots, so Convex never
 * deploys it.
 */

export const MAILBOX = "milad@afternoonumbrellafriends.com";
export const ALIAS = "milad@auf.network";
export const REFRESH_TOKEN = "1//fake-refresh";

type Call = { method: string; url: URL; form: Record<string, string>; json: unknown; token: string | null };
type Answer = { status?: number; body: unknown };
type Route = (call: Call) => Answer;

export class FakeGmail {
  readonly calls: Call[] = [];
  /** Codes the token endpoint accepts, each with the verifier its PKCE challenge was made from. */
  readonly codes = new Map<string, { verifier?: string; scope: string }>();
  /** Access tokens minted so far; the newest is live, older ones expire. */
  readonly accessTokens: string[] = [];
  revokedRefresh = false;
  /** The refresh grant answers this error instead of a token. */
  refreshError: string | null = null;
  private minted = 0;
  private readonly routes: [RegExp, string, Route][] = [];

  constructor() {
    this.on("POST", /^https:\/\/oauth2\.googleapis\.com\/token$/, (call) => this.token(call));
    this.on("POST", /^https:\/\/oauth2\.googleapis\.com\/revoke$/, (call) => {
      if (call.form.token === REFRESH_TOKEN) this.revokedRefresh = true;
      return { body: {} };
    });
    this.on("GET", /\/users\/me\/profile$/, () => ({ body: { emailAddress: MAILBOX, historyId: "1000" } }));
    this.on("GET", /\/users\/me\/settings\/sendAs$/, () => ({ body: { sendAs: [{ sendAsEmail: MAILBOX }, { sendAsEmail: ALIAS }] } }));
  }

  /** The live access token. */
  get accessToken(): string | undefined {
    return this.accessTokens[this.accessTokens.length - 1];
  }

  private mint(): string {
    const token = `ya29.fake-${++this.minted}`;
    this.accessTokens.push(token);
    return token;
  }

  private token(call: Call): Answer {
    const { form } = call;
    if (!form.client_secret) return { status: 401, body: { error: "invalid_client" } };
    if (form.grant_type === "authorization_code") {
      const grant = this.codes.get(form.code ?? "");
      if (!grant) return { status: 400, body: { error: "invalid_grant" } };
      if (grant.verifier !== undefined && grant.verifier !== form.code_verifier) return { status: 400, body: { error: "invalid_grant" } };
      this.codes.delete(form.code!);
      return { body: { access_token: this.mint(), expires_in: 3599, refresh_token: REFRESH_TOKEN, scope: grant.scope, token_type: "Bearer" } };
    }
    if (form.grant_type === "refresh_token") {
      if (this.refreshError) return { status: 400, body: { error: this.refreshError } };
      if (form.refresh_token !== REFRESH_TOKEN || this.revokedRefresh) return { status: 400, body: { error: "invalid_grant" } };
      return { body: { access_token: this.mint(), expires_in: 3599, scope: "openid email", token_type: "Bearer" } };
    }
    return { status: 400, body: { error: "unsupported_grant_type" } };
  }

  /** Adds or replaces an endpoint's answer. Later routes win. */
  on(method: string, url: RegExp, route: Route): this {
    this.routes.unshift([url, method, route]);
    return this;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = init?.body;
    const form = body instanceof URLSearchParams ? Object.fromEntries(body) : {};
    const json = typeof body === "string" ? JSON.parse(body) as unknown : undefined;
    const auth = new Headers(init?.headers).get("Authorization");
    const call: Call = { method, url, form, json, token: auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null };
    this.calls.push(call);
    const route = this.routes.find(([pattern, verb]) => verb === method && pattern.test(`${url.origin}${url.pathname}`));
    if (!route) throw new Error(`FakeGmail: unexpected ${method} ${url.href}`);
    if (url.host === "gmail.googleapis.com" && call.token !== this.accessToken) {
      return Response.json({ error: { code: 401, status: "UNAUTHENTICATED" } }, { status: 401 });
    }
    const answer = route[2](call);
    return Response.json(answer.body, { status: answer.status ?? 200 });
  };

  install(): this {
    vi.stubGlobal("fetch", this.fetch);
    return this;
  }

  /** Calls to a Gmail API path, such as "/threads". */
  gmailCalls(path: string): Call[] {
    return this.calls.filter((call) => call.url.host === "gmail.googleapis.com" && call.url.pathname.includes(path));
  }
}

/** The env a Comma deployment with Gmail set up has. */
export function stubGmailEnv(): void {
  vi.stubEnv("CONVEX_SITE_URL", "https://comma.test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("COMMA_TOKEN_KEY", `1:${btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))}`);
}
