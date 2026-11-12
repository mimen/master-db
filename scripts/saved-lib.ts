// Client side of master-db's /saved/* routes, shared by the saved-items importers and triage pass.
// Env: SAVED_INGEST_SECRET (op://Sol/Saved Ingest Secret/credential), SAVED_INGEST_URL (default below).

export type Platform = "x" | "instagram";
export type Media = { type: "image" | "video"; url: string; storage_id?: string; width?: number; height?: number };
export type SavedItemIn = {
  platform: Platform;
  platform_id: string;
  url: string;
  author?: string;
  text?: string;
  posted_at?: string;
  saved_at?: string;
  links: string[];
  media: Media[];
  collections: string[];
  raw?: string;
};

const BASE = (process.env.SAVED_INGEST_URL ?? "https://shiny-gerbil-853.convex.site").replace(/\/+$/, "");
const SECRET = process.env.SAVED_INGEST_SECRET;

export async function call<T>(path: string, body: unknown): Promise<T> {
  if (!SECRET) throw new Error("SAVED_INGEST_SECRET is not set");
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} returned ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function knownIds(platform: Platform, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { known } = await call<{ known: string[] }>("/saved/known", { platform, platform_ids: ids });
  return new Set(known);
}

/** Pass items oldest-saved first: the review page orders by insertion, newest first. */
export async function ingest(items: SavedItemIn[], batch = 25) {
  let inserted = 0, updated = 0;
  for (let i = 0; i < items.length; i += batch) {
    const r = await call<{ inserted: number; updated: number }>("/saved/ingest", { items: items.slice(i, i + batch) });
    inserted += r.inserted;
    updated += r.updated;
  }
  return { inserted, updated };
}

/** Copies one remote file into Convex storage and returns its storage id. */
export async function store(url: string): Promise<string> {
  const src = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!src.ok) throw new Error(`download ${src.status} ${url.slice(0, 80)}`);
  const { uploadUrl } = await call<{ uploadUrl: string }>("/saved/upload-url", {});
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": src.headers.get("content-type") ?? "application/octet-stream" },
    body: await src.arrayBuffer(),
    signal: AbortSignal.timeout(180_000),
  });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  return ((await up.json()) as { storageId: string }).storageId;
}

/**
 * Pages are newest-first. Keeps every id up to the first one already stored, and reports
 * whether paging can stop. That stop is what keeps a daily X run to one cheap page.
 */
export function takeUntilKnown<T>(page: T[], id: (t: T) => string, known: Set<string>) {
  const i = page.findIndex((t) => known.has(id(t)));
  return i < 0 ? { fresh: page, done: false } : { fresh: page.slice(0, i), done: true };
}
