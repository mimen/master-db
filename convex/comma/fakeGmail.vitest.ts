import { vi } from "vitest";

/**
 * A fake Google behind `fetch`, for Convex tests: OAuth's token and revoke endpoints and the Gmail API calls Comma
 * makes, for one mailbox. It checks the bearer token and records every call. The name has two dots, so Convex never
 * deploys it.
 */

export const MAILBOX = "milad@afternoonumbrellafriends.com";
export const ALIAS = "milad@auf.network";
export const REFRESH_TOKEN = "1//fake-refresh";

/** One message in the fake mailbox. Headers are the RFC 5322 ones Gmail returns; bodies are served on a full read. */
export type FakeMail = {
  id: string; threadId: string; labelIds: string[]; internalDate: number; headers: Record<string, string>;
  text?: string; html?: string; snippet?: string; files?: FakeFile[];
};
/** An attachment part. `inlineData`: Gmail serves a small part's bytes in the message itself, with no attachmentId. */
export type FakeFile = { filename: string; mimeType: string; data: string; contentId?: string; inlineData?: boolean };

export const PUSH_SERVICE_ACCOUNT = "comma-gmail-push@comma-auf.iam.gserviceaccount.com";
export const PUSH_TOPIC = "projects/comma-auf/topics/comma-gmail";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64text = (text: string) => b64url(new TextEncoder().encode(text));

type Call = { method: string; url: URL; form: Record<string, string>; json: unknown; raw?: { contentType: string; body: string }; token: string | null };

/** A multipart/related upload: its JSON metadata, then the message/rfc822 part. */
function parseUpload(call: Call): { raw: string; threadId?: string } {
  const boundary = /boundary=([^;]+)/.exec(call.raw?.contentType ?? "")?.[1] ?? "";
  const [meta = "", message = ""] = (call.raw?.body ?? "").split(`--${boundary}`).slice(1, 3).map((part) => part.slice(part.indexOf("\r\n\r\n") + 4));
  const metadata = JSON.parse(meta.trim()) as { threadId?: string };
  return { raw: message.replace(/\r\n$/, ""), ...(metadata.threadId ? { threadId: metadata.threadId } : {}) };
}
type Answer = { status?: number; body: unknown };
type Route = (call: Call) => Answer;

export class FakeGmail {
  readonly calls: Call[] = [];
  /** Codes the token endpoint accepts, each with the verifier its PKCE challenge was made from. */
  readonly codes = new Map<string, { verifier?: string; scope: string }>();
  /** Access tokens minted so far; the newest is live, older ones expire. */
  readonly accessTokens: string[] = [];
  revokedRefresh = false;
  /** The address the profile answers, so a test can connect a second mailbox. */
  mailbox = MAILBOX;
  /** The refresh grant answers this error instead of a token. */
  refreshError: string | null = null;
  private minted = 0;
  private readonly routes: [RegExp, string, Route][] = [];
  readonly mail: FakeMail[] = [];
  /** Changes since the mailbox began, newest last; history.list answers from these. */
  readonly history: { id: number; threadId: string }[] = [];
  historyId = 1000;
  /** history.list forgets anything at or before this id, as Gmail does after about a week. */
  forgetBefore = 0;
  /** Threads per page on threads.list. */
  pageSize = 100;
  watches: { topicName: string }[] = [];
  /** Every message users.messages.send took, as its RFC 822 text, with the threadId it was sent into and whether it came through the upload endpoint. */
  readonly sent: { raw: string; threadId?: string; upload: boolean }[] = [];
  /** Gmail mints a new attachment id on every read; the fake does too, so a stale one fails. */
  private reads = 0;
  /** Gmail sets its own Message-ID on a send instead of keeping Comma's. */
  replacesMessageId = false;
  stopped = false;
  private keys: CryptoKeyPair | null = null;
  readonly kid = `kid-${Math.random().toString(36).slice(2)}`;

  constructor() {
    this.on("POST", /^https:\/\/oauth2\.googleapis\.com\/token$/, (call) => this.token(call));
    this.on("POST", /^https:\/\/oauth2\.googleapis\.com\/revoke$/, (call) => {
      if (call.form.token === REFRESH_TOKEN) this.revokedRefresh = true;
      return { body: {} };
    });
    this.on("GET", /\/users\/me\/profile$/, () => ({ body: { emailAddress: this.mailbox, historyId: String(this.historyId) } }));
    this.on("GET", /\/users\/me\/threads$/, (call) => this.listThreads(call));
    this.on("GET", /\/users\/me\/threads\/[^/]+$/, (call) => this.thread(call));
    this.on("GET", /\/users\/me\/history$/, (call) => this.listHistory(call));
    this.on("POST", /\/users\/me\/watch$/, (call) => {
      this.watches.push(call.json as { topicName: string });
      return { body: { historyId: String(this.historyId), expiration: String(Date.now() + 7 * 86_400_000) } };
    });
    this.on("POST", /\/users\/me\/stop$/, () => {
      this.stopped = true;
      return { body: {} };
    });
    this.on("GET", /^https:\/\/www\.googleapis\.com\/oauth2\/v3\/certs$/, () => ({ body: { keys: this.publicJwk ? [this.publicJwk] : [] } }));
    this.on("POST", /\/users\/me\/messages\/send$/, (call) => this.send(call));
    this.on("GET", /\/users\/me\/messages$/, (call) => {
      const wanted = /^rfc822msgid:(.+)$/.exec(call.url.searchParams.get("q") ?? "")?.[1];
      const found = this.mail.filter((message) => wanted && message.headers["Message-ID"] === `<${wanted}>`);
      return { body: found.length ? { messages: found.map((message) => ({ id: message.id, threadId: message.threadId })) } : {} };
    });
    this.on("GET", /\/users\/me\/messages\/[^/]+\/attachments\/[^/]+$/, (call) => {
      const [, id, , attachmentId] = call.url.pathname.split("/").slice(-4).map(decodeURIComponent);
      const [read, index] = (attachmentId ?? "").split(".").slice(1).map(Number);
      const file = this.mail.find((message) => message.id === id)?.files?.[index ?? -1];
      if (!file || read !== this.reads) return { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } };
      return { body: { size: file.data.length, data: b64text(file.data) } };
    });
    this.on("GET", /\/users\/me\/messages\/[^/]+$/, (call) => {
      const message = this.mail.find((candidate) => candidate.id === decodeURIComponent(call.url.pathname.split("/").pop()!));
      return message ? { body: this.serialize(message, "full", new Set()) } : { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } };
    });
    this.on("POST", /\/users\/me\/threads\/[^/]+\/modify$/, (call) => {
      const threadId = decodeURIComponent(call.url.pathname.split("/").slice(-2)[0]!);
      if (!this.mail.some((message) => message.threadId === threadId)) return { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } };
      const { addLabelIds = [], removeLabelIds = [] } = call.json as { addLabelIds?: string[]; removeLabelIds?: string[] };
      this.relabel(threadId, { add: addLabelIds, remove: removeLabelIds });
      return { body: { id: threadId } };
    });
    this.on("POST", /\/users\/me\/messages\/batchModify$/, (call) => {
      const { ids = [], addLabelIds = [], removeLabelIds = [] } = call.json as { ids?: string[]; addLabelIds?: string[]; removeLabelIds?: string[] };
      const messages = this.mail.filter((message) => ids.includes(message.id));
      if (messages.length !== ids.length) return { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } };
      for (const message of messages) {
        message.labelIds = [...new Set([...message.labelIds.filter((label) => !removeLabelIds.includes(label)), ...addLabelIds])];
      }
      for (const threadId of new Set(messages.map((message) => message.threadId))) this.record(threadId);
      return { body: {} };
    });
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

  private record(threadId: string): void {
    this.historyId += 1;
    this.history.push({ id: this.historyId, threadId });
  }

  /** A message arrives (or is sent) in the mailbox. */
  deliver(mail: Omit<FakeMail, "internalDate"> & { internalDate?: number }): FakeMail {
    const full = { internalDate: Date.now(), ...mail };
    this.mail.push(full);
    this.record(full.threadId);
    return full;
  }

  /** Adds and removes labels on every message in a thread, as archiving or moving to Inbox does. */
  relabel(threadId: string, { add = [], remove = [] }: { add?: string[]; remove?: string[] }): void {
    for (const message of this.mail.filter((candidate) => candidate.threadId === threadId)) {
      message.labelIds = [...new Set([...message.labelIds.filter((label) => !remove.includes(label)), ...add])];
    }
    this.record(threadId);
  }

  private threadIds(q: string): string[] {
    const threads = new Map<string, FakeMail[]>();
    for (const message of this.mail) threads.set(message.threadId, [...(threads.get(message.threadId) ?? []), message]);
    const has = (messages: FakeMail[], label: string) => messages.some((message) => message.labelIds.includes(label));
    const newest = (messages: FakeMail[]) => Math.max(...messages.map((message) => message.internalDate));
    const days = Number(/newer_than:(\d+)d/.exec(q)?.[1] ?? Infinity);
    return [...threads].filter(([, messages]) => q === "in:inbox" ? has(messages, "INBOX")
      : !has(messages, "INBOX") && !has(messages, "SPAM") && !has(messages, "TRASH") && Date.now() - newest(messages) < days * 86_400_000)
      .sort(([, a], [, b]) => newest(b) - newest(a)).map(([id]) => id);
  }

  private listThreads(call: Call): Answer {
    const ids = this.threadIds(call.url.searchParams.get("q") ?? "");
    const start = Number(call.url.searchParams.get("pageToken") ?? 0);
    const size = Math.min(this.pageSize, Number(call.url.searchParams.get("maxResults") ?? 100));
    const page = ids.slice(start, start + size);
    return { body: { threads: page.map((id) => ({ id })), ...(start + size < ids.length ? { nextPageToken: String(start + size) } : {}) } };
  }

  private thread(call: Call): Answer {
    const threadId = decodeURIComponent(call.url.pathname.split("/").pop()!);
    const messages = this.mail.filter((message) => message.threadId === threadId);
    if (!messages.length) return { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } };
    const format = call.url.searchParams.get("format");
    const wanted = new Set(call.url.searchParams.getAll("metadataHeaders").map((name) => name.toLowerCase()));
    return { body: { id: threadId, historyId: String(this.historyId), messages: messages.map((message) => this.serialize(message, format, wanted)) } };
  }

  private serialize(message: FakeMail, format: string | null, wanted: Set<string>) {
    if (format === "full") this.reads++;
    const text = (message.text !== undefined ? [{ mimeType: "text/plain", body: { data: b64text(message.text) } }] : [])
      .concat(message.html !== undefined ? [{ mimeType: "text/html", body: { data: b64text(message.html) } }] : []);
    const files = (message.files ?? []).map((file, index) => ({
      partId: String(index + 1), mimeType: file.mimeType, filename: file.filename,
      headers: file.contentId ? [{ name: "Content-ID", value: `<${file.contentId}>` }] : [],
      body: file.inlineData ? { size: file.data.length, data: b64text(file.data) } : { size: file.data.length, attachmentId: `att.${this.reads}.${index}` },
    }));
    const parts = files.length
      ? [{ partId: "0", mimeType: "multipart/alternative", parts: text.map((part, index) => ({ ...part, partId: `0.${index}` })) }, ...files]
      : text.map((part, index) => ({ ...part, partId: String(index) }));
    return {
      id: message.id, threadId: message.threadId, labelIds: message.labelIds, internalDate: String(message.internalDate),
      snippet: message.snippet ?? (message.text ?? "").slice(0, 100),
      payload: {
        partId: "", mimeType: files.length ? "multipart/mixed" : "multipart/alternative",
        headers: Object.entries(message.headers).filter(([name]) => format === "full" || wanted.has(name.toLowerCase())).map(([name, value]) => ({ name, value })),
        ...(format === "full" ? { parts } : {}),
      },
    };
  }

  /** users.messages.send: the raw message joins its thread (or starts one) as a SENT message, as Gmail files it. */
  private send(call: Call): Answer {
    const upload = call.url.pathname.startsWith("/upload/");
    const { raw: text, threadId } = upload ? parseUpload(call) : (({ raw, threadId: id }) => ({
      raw: new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))), threadId: id,
    }))(call.json as { raw: string; threadId?: string });
    if (upload && call.url.searchParams.get("uploadType") !== "multipart") return { status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT" } } };
    this.sent.push({ raw: text, upload, ...(threadId ? { threadId } : {}) });
    const { headers, parts, files } = parseRfc822(text);
    if (this.replacesMessageId) headers["Message-ID"] = `<gmail-${this.sent.length}@mail.gmail.com>`;
    const mail = this.deliver({
      id: `sent-${this.sent.length}`, threadId: threadId ?? `thread-sent-${this.sent.length}`, labelIds: ["SENT"], headers,
      text: parts["text/plain"], html: parts["text/html"], files: files.map(({ filename, mimeType, text: data }) => ({ filename, mimeType, data })),
    });
    return { body: { id: mail.id, threadId: mail.threadId, labelIds: mail.labelIds } };
  }

  private listHistory(call: Call): Answer {
    const start = Number(call.url.searchParams.get("startHistoryId"));
    if (start < this.forgetBefore) return { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } };
    const entries = this.history.filter((entry) => entry.id > start);
    return { body: { historyId: String(this.historyId), ...(entries.length ? { history: entries.map((entry) => ({
      id: String(entry.id), messages: [{ id: `h${entry.id}`, threadId: entry.threadId }],
    })) } : {}) } };
  }

  private publicJwk: (JsonWebKey & { kid: string }) | null = null;

  /** A Pub/Sub push's OIDC token, signed by this fake's key (or `signer`'s, to forge one). Claims override the valid defaults. */
  async oidcToken(claims: Record<string, unknown> = {}, signer?: FakeGmail): Promise<string> {
    const keys = await (signer ?? this).keyPair();
    await this.keyPair();
    const now = Math.floor(Date.now() / 1000);
    const header = b64text(JSON.stringify({ alg: "RS256", kid: this.kid, typ: "JWT" }));
    const payload = b64text(JSON.stringify({
      iss: "https://accounts.google.com", aud: "https://comma.test/comma/gmail/push", email: PUSH_SERVICE_ACCOUNT, email_verified: true,
      sub: "1234", iat: now, exp: now + 3600, ...claims,
    }));
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
  }

  private async keyPair(): Promise<CryptoKeyPair> {
    if (!this.keys) {
      this.keys = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      this.publicJwk = { ...(await crypto.subtle.exportKey("jwk", this.keys.publicKey)), kid: this.kid };
    }
    return this.keys;
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
    const contentType = new Headers(init?.headers).get("Content-Type") ?? "";
    const raw = typeof body === "string" && contentType.startsWith("multipart/") ? { contentType, body } : undefined;
    const json = typeof body === "string" && !raw ? JSON.parse(body) as unknown : undefined;
    const auth = new Headers(init?.headers).get("Authorization");
    const call: Call = { method, url, form, json, raw, token: auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null };
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

type ParsedFile = { filename: string; mimeType: string; disposition: string; text: string };

/**
 * An RFC 822 message's headers, its base64 text parts by type, and its attachment parts, as the Gmail lane writes them.
 * A multipart/mixed body is read through to the multipart/alternative inside it.
 */
export function parseRfc822(text: string): { headers: Record<string, string>; parts: Record<string, string>; files: ParsedFile[] } {
  const split = text.indexOf("\r\n\r\n");
  const head = text.slice(0, split);
  const headers = Object.fromEntries(head.split("\r\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]));
  const parts: Record<string, string> = {};
  const files: ParsedFile[] = [];
  const decode = (body: string) => new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s+/g, "")), (char) => char.charCodeAt(0)));
  const walk = (contentType: string, body: string) => {
    const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1];
    if (!boundary) return;
    for (const chunk of body.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith("--")) break;
      const at = chunk.indexOf("\r\n\r\n");
      const partHead = chunk.slice(0, at);
      const partBody = chunk.slice(at + 4);
      const type = /Content-Type: ([^\r\n]+)/.exec(partHead)?.[1] ?? "";
      const disposition = /Content-Disposition: ([^\r\n]+)/.exec(partHead)?.[1];
      if (type.startsWith("multipart/")) walk(type, partBody);
      else if (disposition) files.push({ filename: /filename="([^"]*)"/.exec(disposition)?.[1] ?? "", mimeType: type.split(";")[0]!.trim(), disposition, text: decode(partBody) });
      else parts[type.split(";")[0]!.trim()] = decode(partBody);
    }
  };
  walk(headers["Content-Type"] ?? "", text.slice(split + 4));
  return { headers, parts, files };
}

/** A Pub/Sub push request for a change in `emailAddress`'s mailbox. */
export function pushBody(emailAddress = MAILBOX, historyId = 1): string {
  return JSON.stringify({
    message: { data: btoa(JSON.stringify({ emailAddress, historyId })), messageId: "1", publishTime: new Date().toISOString() },
    subscription: "projects/comma-auf/subscriptions/comma-gmail-push",
  });
}

/** The env a Comma deployment with Gmail set up has. */
export function stubGmailEnv(): void {
  vi.stubEnv("CONVEX_SITE_URL", "https://comma.test");
  vi.stubEnv("GMAIL_PUSH_SERVICE_ACCOUNT", PUSH_SERVICE_ACCOUNT);
  vi.stubEnv("GMAIL_PUSH_TOPIC", PUSH_TOPIC);
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("GOOGLE_PERSONAL_CLIENT_ID", "google-personal-client-id");
  vi.stubEnv("GOOGLE_PERSONAL_CLIENT_SECRET", "google-personal-client-secret");
  vi.stubEnv("COMMA_TOKEN_KEY", `1:${btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))}`);
}
