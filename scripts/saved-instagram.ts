#!/usr/bin/env bun
// Instagram saved posts -> master-db saved_items, media copied into Convex storage (IG CDN URLs expire).
// Reads through the instagram skill's saved-session plumbing (ClaudeConfig/skills/instagram/scripts/ig.ts),
// which aborts every read and seen receipt. Read only: it never likes, saves, or unsaves.
//
//   bun run scripts/saved-instagram.ts [account] [--full]
//
// Walks "All posts" newest-saved first and stops at the first post already stored; --full walks everything.
// A post's collection names become its collections. Exit 2 means the session is dead and needs a re-capture.
import { homedir } from "node:os";
import { join } from "node:path";

import { ingest, knownIds, store, takeUntilKnown, type Media, type SavedItemIn } from "./saved-lib";

type Candidate = { url: string; width?: number; height?: number };
type IgMedia = {
  code: string; taken_at?: number; product_type?: string; media_type?: number;
  user?: { username?: string }; caption?: { text?: string } | null; saved_collection_ids?: string[];
  image_versions2?: { candidates?: Candidate[] }; video_versions?: Candidate[]; carousel_media?: IgMedia[];
  clips_metadata?: {
    music_info?: { music_asset_info?: { display_artist?: string; title?: string } };
    original_sound_info?: { ig_artist?: { username?: string }; original_audio_title?: string };
  };
};
type Collection = { collection_id: string; collection_name: string; collection_media_count?: number | null };

const argv = process.argv.slice(2);
const full = argv.includes("--full");
const account = argv.find((a) => !a.startsWith("--")) ?? "sproutbeats";

const ig = await import(join(homedir(), ".claude/skills/instagram/scripts/ig.ts"));
const { page, close } = await ig.openInstagram(account);
let posts: IgMedia[] = [];
let names = new Map<string, string>();
try {
  const rest = ig.restSession(page).catch(() => null);
  const tabQuery = ig.captureQuery(page, "PolarisProfileSavedTabContentQuery").catch(() => null);
  await page.goto(`https://www.instagram.com/${account}/saved/`, { waitUntil: "domcontentloaded" });
  const [h, q] = await Promise.all([rest, tabQuery]);
  if (!h || !q || page.url().includes("/accounts/login")) {
    console.error(`instagram session for ${account} is dead (landed on ${page.url()}); re-capture ~/.config/sol-sessions/instagram/${account}.json`);
    process.exit(2);
  }
  const tab = await ig.gql(page, q, { ...q.variables, first: 200 });
  const cols: Collection[] = tab.data.viewer.collections_unified_with_auto_collections.edges.map((e: { node: Collection }) => e.node);
  names = new Map(cols.filter((c) => c.collection_id !== "ALL_MEDIA_AUTO_COLLECTION").map((c) => [c.collection_id, c.collection_name.trim()]));

  for (let maxId = ""; ;) {
    const res = await ig.api(page, h, `/api/v1/feed/saved/posts/${maxId ? `?max_id=${encodeURIComponent(maxId)}` : ""}`);
    const batch: IgMedia[] = res.items.map((i: { media: IgMedia }) => i.media);
    const known = full ? new Set<string>() : await knownIds("instagram", batch.map((m) => m.code));
    const cut = takeUntilKnown(batch, (m) => m.code, known);
    posts.push(...cut.fresh);
    if (cut.done || !res.more_available || !res.next_max_id) break;
    maxId = res.next_max_id;
    await ig.pause();
  }
} finally {
  await close();
}

if (full) {
  const known = new Set<string>();
  for (let i = 0; i < posts.length; i += 200) for (const id of await knownIds("instagram", posts.slice(i, i + 200).map((m) => m.code))) known.add(id);
  posts = posts.filter((m) => !known.has(m.code));
}

let files = 0, failed = 0, inserted = 0;
const oldestFirst = [...posts].reverse();
for (let i = 0; i < oldestFirst.length; i += 8) {
  const items = await Promise.all(oldestFirst.slice(i, i + 8).map(toItem));
  inserted += (await ingest(items)).inserted;
  if (i % 96 === 0) console.error(`instagram: ${i + items.length}/${posts.length} posts, ${files} files stored`);
}
console.log(`instagram ${account}: ${inserted} new saved posts, ${files} media files stored${failed ? `, ${failed} media failed to copy (kept original URL)` : ""}`);

async function toItem(m: IgMedia): Promise<SavedItemIn> {
  const music = m.clips_metadata?.music_info?.music_asset_info;
  const sound = m.clips_metadata?.original_sound_info;
  const audio = music ? `${music.display_artist} - ${music.title}` : sound ? `${sound.ig_artist?.username ?? ""} - ${sound.original_audio_title}` : "";
  const caption = m.caption?.text ?? "";
  return {
    platform: "instagram",
    platform_id: m.code,
    url: `https://www.instagram.com/${m.product_type === "clips" ? "reel" : "p"}/${m.code}/`,
    author: m.user?.username,
    text: audio ? `${caption}\n\nAudio: ${audio}`.trim() : caption,
    posted_at: m.taken_at ? new Date(m.taken_at * 1000).toISOString() : undefined,
    links: [],
    media: await Promise.all((m.carousel_media ?? [m]).flatMap(pick).map(copy)),
    collections: (m.saved_collection_ids ?? []).flatMap((id) => names.get(id) ?? []),
    raw: JSON.stringify(m),
  };
}

function pick(m: IgMedia): Media[] {
  const v = m.video_versions?.[0];
  if (v) return [{ type: "video", url: v.url, width: v.width, height: v.height }];
  const c = m.image_versions2?.candidates?.[0];
  return c ? [{ type: "image", url: c.url, width: c.width, height: c.height }] : [];
}

async function copy(media: Media): Promise<Media> {
  try {
    const storage_id = await store(media.url);
    files += 1;
    return { ...media, storage_id };
  } catch (e) {
    failed += 1;
    console.error(`instagram: media copy failed: ${(e as Error).message}`);
    return media;
  }
}
