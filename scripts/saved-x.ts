#!/usr/bin/env bun
// X bookmarks -> master-db saved_items. GET requests only; never posts, likes, or bookmarks.
// Signing is the x-saved skill's (ClaudeConfig/skills/x-saved/scripts/x-saved.ts).
//
//   bun run scripts/saved-x.ts --from-file bookmarks.json   # backfill a file x-saved.ts already paid for
//   bun run scripts/saved-x.ts [--max 100]                  # incremental: newest first, stop at the first stored id
//
// X bills $0.001 per bookmark returned, so pages are small and --max caps one run's spend.
// Env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, X_USER_ID, SAVED_INGEST_SECRET.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { ingest, knownIds, takeUntilKnown, type Media, type SavedItemIn } from "./saved-lib";

type FileRow = { id: string; url: string; author?: string; created_at?: string; text?: string; likes?: number; links?: string[] };
type Tweet = {
  id: string; text: string; created_at?: string; author_id?: string;
  entities?: { urls?: { expanded_url?: string }[] };
  attachments?: { media_keys?: string[] };
};
type XMedia = {
  media_key: string; type: "photo" | "video" | "animated_gif"; url?: string; preview_image_url?: string;
  width?: number; height?: number; variants?: { content_type: string; url: string; bit_rate?: number }[];
};
type Page = {
  data?: Tweet[];
  includes?: { users?: { id: string; username: string }[]; media?: XMedia[] };
  meta?: { next_token?: string };
};

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };

const fromFile = flag("--from-file");
if (fromFile) {
  const rows = JSON.parse(readFileSync(fromFile, "utf8")) as FileRow[];
  const r = await ingest(rows.map(fromFileRow).reverse());
  console.log(`x backfill: ${rows.length} bookmarks from file, ${r.inserted} new, ${r.updated} updated, 0 API reads`);
  process.exit(0);
}

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const creds = { key: env("X_API_KEY"), secret: env("X_API_SECRET"), token: env("X_ACCESS_TOKEN"), tokenSecret: env("X_ACCESS_SECRET") };
const userId = env("X_USER_ID");
const max = Number(flag("--max") ?? 100);
const PAGE = 10;

const fresh: SavedItemIn[] = [];
let reads = 0, token: string | undefined, done = false;
while (!done && fresh.length < max) {
  const q: Record<string, string> = {
    max_results: String(PAGE),
    expansions: "author_id,attachments.media_keys",
    "user.fields": "username",
    "tweet.fields": "created_at,author_id,entities,attachments",
    "media.fields": "type,url,preview_image_url,variants,width,height",
  };
  if (token) q.pagination_token = token;
  const page = await get<Page>(`/users/${userId}/bookmarks`, q);
  const tweets = page.data ?? [];
  reads += tweets.length;
  const users = new Map((page.includes?.users ?? []).map((u) => [u.id, u.username]));
  const media = new Map((page.includes?.media ?? []).map((m) => [m.media_key, m]));
  const known = await knownIds("x", tweets.map((t) => t.id));
  const cut = takeUntilKnown(tweets, (t) => t.id, known);
  fresh.push(...cut.fresh.map((t) => fromApi(t, users, media)));
  token = page.meta?.next_token;
  done = cut.done || !token;
}

const r = await ingest(fresh.slice(0, max).reverse());
console.log(`x incremental: ${r.inserted} new bookmarks, ${reads} posts read (~$${(reads * 0.001).toFixed(3)})${done ? "" : `, stopped at --max ${max}`}`);

function fromFileRow(b: FileRow): SavedItemIn {
  return {
    platform: "x", platform_id: b.id, url: b.url, author: b.author, text: b.text, posted_at: b.created_at,
    links: b.links ?? [], media: [], collections: [], raw: JSON.stringify(b),
  };
}

function fromApi(t: Tweet, users: Map<string, string>, media: Map<string, XMedia>): SavedItemIn {
  const author = t.author_id ? users.get(t.author_id) : undefined;
  const ms = (t.attachments?.media_keys ?? []).map((k) => media.get(k)).filter((m): m is XMedia => !!m);
  return {
    platform: "x", platform_id: t.id, url: `https://x.com/${author ?? "i"}/status/${t.id}`, author, text: t.text,
    posted_at: t.created_at, links: (t.entities?.urls ?? []).flatMap((u) => (u.expanded_url ? [u.expanded_url] : [])),
    media: ms.flatMap(toMedia), collections: [], raw: JSON.stringify({ ...t, media: ms }),
  };
}

function toMedia(m: XMedia): Media[] {
  if (m.type === "photo") return m.url ? [{ type: "image", url: m.url, width: m.width, height: m.height }] : [];
  const mp4 = (m.variants ?? []).filter((v) => v.content_type === "video/mp4").sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
  if (mp4) return [{ type: "video", url: mp4.url, width: m.width, height: m.height }];
  return m.preview_image_url ? [{ type: "image", url: m.preview_image_url, width: m.width, height: m.height }] : [];
}

async function get<T>(path: string, q: Record<string, string>): Promise<T> {
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const base = `https://api.x.com/2${path}`;
  const o: Record<string, string> = {
    oauth_consumer_key: creds.key, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: creds.token, oauth_version: "1.0",
  };
  const all = { ...q, ...o };
  const params = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
  o.oauth_signature = createHmac("sha1", `${enc(creds.secret)}&${enc(creds.tokenSecret)}`).update(`GET&${enc(base)}&${enc(params)}`).digest("base64");
  const auth = "OAuth " + Object.keys(o).map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ");
  const r = await fetch(`${base}?${new URLSearchParams(q)}`, { headers: { authorization: auth }, signal: AbortSignal.timeout(30_000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`X ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as T;
}
