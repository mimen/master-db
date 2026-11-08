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

export type FakeUser = { id: string; name: string; email?: string; is_bot?: boolean };
export type FakeMessage = {
  ts: string; user: string; text: string; thread_ts?: string; reply_count?: number; edited?: { ts: string }; subtype?: string;
  metadata?: { event_type: string; event_payload: Record<string, unknown> }; reactions?: { name: string; users: string[] }[];
};
export type FakeChannel = { id: string; type: "im" | "mpim" | "channel"; name?: string; user?: string; members?: string[]; messages: FakeMessage[] };

export class FakeSlack {
  readonly calls: { method: string; params: Params; token: string | null }[] = [];
  readonly users = new Map<string, FakeUser>([[MILAD, { id: MILAD, name: "Milad", email: "milad@afternoonumbrellafriends.com" }]]);
  readonly channels = new Map<string, FakeChannel>();
  /** Items per page on every paged read, small enough that tests cross pages. */
  pageSize = 200;
  /** Methods that answer HTTP 429 once, with this Retry-After. */
  readonly rateLimitOnce = new Map<string, number>();
  /** Codes oauth.v2.access accepts, and the team each one installs into. */
  readonly codes = new Map<string, { team: typeof TEAM; user: string }>([["good-code", { team: TEAM, user: MILAD }]]);
  revoked = false;
  /** Each conversation's read marker, as conversations.mark last set it. */
  readonly marks = new Map<string, string>();
  /** Keeps message metadata on posts. Slack's handling of it on user-token posts is unconfirmed, so tests try both. */
  keepsMetadata = true;
  private clock = 1_800_000_000;

  /** A ts after every other this fake has made, as Slack's are. */
  nextTs(): string {
    this.clock += 1;
    return `${this.clock}.000100`;
  }

  /** The message at `ts` in `channel`, or an error answer. */
  private find(params: Params): { channel: FakeChannel; message: FakeMessage } | { error: string } {
    const channel = this.channels.get(params.channel ?? "");
    if (!channel) return { error: "channel_not_found" };
    const message = channel.messages.find((candidate) => candidate.ts === (params.ts ?? params.timestamp));
    return message ? { channel, message } : { error: "message_not_found" };
  }

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
    "users.list": (params) => this.paged("members", [...this.users.values()].map(asUser), params),
    "users.info": (params) => {
      const user = this.users.get(params.user ?? "");
      return user ? { ok: true, user: asUser(user) } : { ok: false, error: "user_not_found" };
    },
    "users.conversations": (params) => this.paged("channels", [...this.channels.values()].map((channel) => ({
      id: channel.id, is_im: channel.type === "im", is_mpim: channel.type === "mpim", user: channel.user, name: channel.name,
    })), params),
    "conversations.info": (params) => {
      const channel = this.channels.get(params.channel ?? "");
      if (!channel) return { ok: false, error: "channel_not_found" };
      return { ok: true, channel: { id: channel.id, is_im: channel.type === "im", is_mpim: channel.type === "mpim", user: channel.user, name: channel.name } };
    },
    "conversations.members": (params) => ({ ok: true, members: this.channels.get(params.channel ?? "")?.members ?? [] }),
    "conversations.history": (params) => {
      const channel = this.channels.get(params.channel ?? "");
      if (!channel) return { ok: false, error: "channel_not_found" };
      const top = channel.messages.filter((message) => !message.thread_ts || message.thread_ts === message.ts || message.subtype === "thread_broadcast");
      return this.paged("messages", newestFirst(after(top, params.oldest)), params);
    },
    "conversations.replies": (params) => {
      const channel = this.channels.get(params.channel ?? "");
      if (!channel) return { ok: false, error: "channel_not_found" };
      const thread = channel.messages.filter((message) => message.ts === params.ts || message.thread_ts === params.ts);
      return this.paged("messages", after(thread, params.oldest).sort((a, b) => Number(a.ts) - Number(b.ts)), params);
    },
    "chat.postMessage": (params) => {
      const channel = this.channels.get(params.channel ?? "");
      if (!channel) return { ok: false, error: "channel_not_found" };
      const metadata = params.metadata && this.keepsMetadata ? JSON.parse(params.metadata) as FakeMessage["metadata"] : undefined;
      const message: FakeMessage = { ts: this.nextTs(), user: MILAD, text: params.text ?? "", ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}), ...(metadata ? { metadata } : {}) };
      channel.messages.push(message);
      return { ok: true, channel: channel.id, ts: message.ts, message: { type: "message", ...message } };
    },
    "chat.update": (params) => {
      const found = this.find(params);
      if ("error" in found) return { ok: false, error: found.error };
      if (found.message.user !== MILAD) return { ok: false, error: "cant_update_message" };
      Object.assign(found.message, { text: params.text ?? "", edited: { ts: this.nextTs() } });
      return { ok: true, channel: found.channel.id, ts: found.message.ts, text: found.message.text };
    },
    "chat.delete": (params) => {
      const found = this.find(params);
      if ("error" in found) return { ok: false, error: found.error };
      if (found.message.user !== MILAD) return { ok: false, error: "cant_delete_message" };
      found.channel.messages.splice(found.channel.messages.indexOf(found.message), 1);
      return { ok: true, channel: found.channel.id, ts: found.message.ts };
    },
    "reactions.add": (params) => {
      const found = this.find(params);
      if ("error" in found) return { ok: false, error: found.error };
      const reactions = (found.message.reactions ??= []);
      const reaction = reactions.find((candidate) => candidate.name === params.name);
      if (reaction?.users.includes(MILAD)) return { ok: false, error: "already_reacted" };
      if (reaction) reaction.users.push(MILAD);
      else reactions.push({ name: params.name ?? "", users: [MILAD] });
      return { ok: true };
    },
    "reactions.remove": (params) => {
      const found = this.find(params);
      if ("error" in found) return { ok: false, error: found.error };
      const reaction = found.message.reactions?.find((candidate) => candidate.name === params.name && candidate.users.includes(MILAD));
      if (!reaction) return { ok: false, error: "no_reaction" };
      reaction.users = reaction.users.filter((user) => user !== MILAD);
      return { ok: true };
    },
    "conversations.mark": (params) => {
      if (!this.channels.has(params.channel ?? "")) return { ok: false, error: "channel_not_found" };
      this.marks.set(params.channel!, params.ts ?? "");
      return { ok: true };
    },
    "search.messages": (params) => {
      const from = /^from:<@(\w+)>/.exec(params.query ?? "")?.[1];
      const mentioned = /^<@(\w+)>/.exec(params.query ?? "")?.[1];
      const matches = [...this.channels.values()].flatMap((channel) => channel.messages
        .filter((message) => (from && message.user === from) || (mentioned && message.text.includes(`<@${mentioned}>`)))
        .map((message) => ({
          ts: message.ts, user: message.user, text: message.text,
          channel: { id: channel.id, is_im: channel.type === "im", is_mpim: channel.type === "mpim" },
          permalink: `https://umbrellafriends.slack.com/archives/${channel.id}/p${message.ts.replace(".", "")}${
            message.thread_ts && message.thread_ts !== message.ts ? `?thread_ts=${message.thread_ts}&cid=${channel.id}` : ""}`,
        })));
      return { ok: true, messages: { matches, paging: { pages: 1 } } };
    },
  };

  private paged(key: string, items: unknown[], params: Params): Record<string, unknown> {
    const start = Number(params.cursor || 0);
    const end = start + this.pageSize;
    return { ok: true, [key]: items.slice(start, end), response_metadata: { next_cursor: end < items.length ? String(end) : "" } };
  }

  /** Adds a conversation to the workspace. */
  channel(channel: Omit<FakeChannel, "messages"> & { messages?: FakeMessage[] }): FakeChannel {
    const full = { messages: [], ...channel };
    this.channels.set(channel.id, full);
    return full;
  }

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
    const retryAfter = this.rateLimitOnce.get(method);
    if (retryAfter !== undefined) {
      this.rateLimitOnce.delete(method);
      return new Response(null, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
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

const asUser = (user: FakeUser) => ({ id: user.id, name: user.name.toLowerCase(), is_bot: user.is_bot ?? false, profile: { display_name: user.name, ...(user.email ? { email: user.email } : {}) } });
const after = (messages: FakeMessage[], oldest?: string) => (oldest ? messages.filter((message) => Number(message.ts) > Number(oldest)) : messages);
const newestFirst = (messages: FakeMessage[]) => [...messages].sort((a, b) => Number(b.ts) - Number(a.ts));

/** An Events API delivery, signed as Slack signs it. */
export async function signedEvent(payload: object, { secret = "signing-secret", at = Math.floor(Date.now() / 1000) } = {}): Promise<RequestInit> {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${at}:${body}`)));
  const signature = `v0=${Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return { method: "POST", body, headers: { "Content-Type": "application/json", "X-Slack-Request-Timestamp": String(at), "X-Slack-Signature": signature } };
}

/** An event_callback around one event. */
export function eventCallback<E extends object>(eventId: string, event: E) {
  return { type: "event_callback", team_id: TEAM.id, api_app_id: "A0COMMA", event_id: eventId, event_time: 1, event };
}
