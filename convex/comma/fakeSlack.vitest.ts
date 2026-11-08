import { vi } from "vitest";

/**
 * A fake Slack Web API behind `fetch`, for Convex tests: it answers the methods Comma calls from the workspace it holds,
 * checks the bearer token, and records every call. The name has two dots, so Convex never deploys it.
 */

export const TEAM = { id: "T066U9Q8F99", name: "AUF" };
export const MILAD = "U066UCP4FS6";
export const TOKEN = "xoxp-fake-milad";

type Params = Record<string, string>;
type Handler = (params: Params, token: string | null) => Record<string, unknown>;

export class FakeSlack {
  readonly calls: { method: string; params: Params; token: string | null }[] = [];
  /** Codes oauth.v2.access accepts, and the team each one installs into. */
  readonly codes = new Map<string, { team: typeof TEAM; user: string }>([["good-code", { team: TEAM, user: MILAD }]]);
  revoked = false;

  private readonly methods: Record<string, Handler> = {
    "oauth.v2.access": (params) => {
      const grant = this.codes.get(params.code ?? "");
      if (!grant || !params.client_secret) return { ok: false, error: "invalid_code" };
      return { ok: true, team: grant.team, authed_user: { id: grant.user, scope: "im:history", access_token: TOKEN, token_type: "user" } };
    },
    "auth.test": () => ({ ok: true, user_id: MILAD, team_id: TEAM.id, team: TEAM.name }),
    "auth.revoke": () => {
      this.revoked = true;
      return { ok: true, revoked: true };
    },
  };

  /** Adds or replaces a method's answer. */
  on(method: string, handler: Handler): this {
    this.methods[method] = handler;
    return this;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.host !== "slack.com") throw new Error(`FakeSlack: unexpected fetch to ${url.href}`);
    const method = url.pathname.replace(/^\/api\//, "");
    const params = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    const auth = new Headers(init?.headers).get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
    this.calls.push({ method, params, token });
    const handler = this.methods[method];
    if (!handler) return Response.json({ ok: false, error: "unknown_method" });
    if (method !== "oauth.v2.access" && token !== TOKEN) return Response.json({ ok: false, error: "invalid_auth" });
    return Response.json(handler(params, token));
  };

  install(): this {
    vi.stubGlobal("fetch", this.fetch);
    return this;
  }
}

/** The env a connected Comma deployment has. */
export function stubSlackEnv(): void {
  vi.stubEnv("CONVEX_SITE_URL", "https://comma.test");
  vi.stubEnv("SLACK_CLIENT_ID", "client-id");
  vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
  vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");
  vi.stubEnv("COMMA_TOKEN_KEY", `1:${btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))}`);
}
