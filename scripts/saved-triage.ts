#!/usr/bin/env bun
// Daily triage of new saved_items: a headless Claude run writes a summary, topic tags, and one suggested
// action per row. It only suggests; status changes are the user's, on the review page.
//
//   bun run scripts/saved-triage.ts [--limit 300] [--batch 20]
//
// The model is the first pick of the "reads and checks" role in ClaudeConfig's model routing.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { call, type Platform } from "./saved-lib";

export const SUGGESTIONS = ["read later", "try this tool", "add to a project", "drop"] as const;
type Suggestion = (typeof SUGGESTIONS)[number];
type Row = { platform: Platform; platform_id: string; url: string; author?: string; text?: string; links: string[]; collections: string[] };
type Result = { platform: Platform; platform_id: string; summary: string; tags: string[]; suggestion: Suggestion };

const ROLES = join(homedir(), "Documents/milad-vault/ClaudeConfig/references/model-routing/roles.json");
const CLAUDE = process.env.CLAUDE_BIN ?? join(homedir(), ".local/bin/claude");

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string, d: number) => { const i = argv.indexOf(n); return i < 0 ? d : Number(argv[i + 1]); };
  const model = (JSON.parse(readFileSync(ROLES, "utf8")) as { roles: Record<string, string[]> }).roles["reads and checks"][0];
  const { items } = await call<{ items: Row[] }>("/saved/untriaged", { limit: flag("--limit", 300) });
  const size = flag("--batch", 20);
  let updated = 0, failedBatches = 0;
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    try {
      const results = parseResults(await ask(model, batch), batch);
      updated += (await call<{ updated: number }>("/saved/triage", { results })).updated;
    } catch (e) {
      failedBatches += 1;
      console.error(`triage batch ${i / size + 1} failed: ${(e as Error).message}`);
    }
    console.error(`triage: ${Math.min(i + size, items.length)}/${items.length}`);
  }
  console.log(`triage (${model}): ${updated} of ${items.length} new items triaged${failedBatches ? `, ${failedBatches} batches failed` : ""}`);
  if (items.length && !updated) process.exit(1);
}

async function ask(model: string, batch: Row[]): Promise<string> {
  const prompt = `You triage a personal inbox of posts the user saved on X and Instagram. For each item write:
- summary: one plain line (max 20 words) saying what the post is.
- tags: 1 to 4 short lowercase topic tags (for example "ai agents", "music production", "fashion", "food").
- suggestion: exactly one of ${SUGGESTIONS.map((s) => `"${s}"`).join(", ")}.
  "try this tool" for a product, app, library, or technique to try; "add to a project" when it fits a project or event the user runs (music, DJ sets, AUF events, AI systems); "read later" for articles, threads, ideas; "drop" for jokes, memes, or nothing actionable.
The user's own collection names are hints. When an item's text is only a link or too short to tell, you may open its link with WebFetch; otherwise do not fetch anything.
Answer with only a JSON array, one object per item, in input order: [{"platform_id": "...", "summary": "...", "tags": ["..."], "suggestion": "..."}].

Items:
${JSON.stringify(batch.map(({ platform, platform_id, author, text, links, collections, url }) => ({ platform, platform_id, url, author, text: text?.slice(0, 1500), links, collections })))}`;
  const proc = Bun.spawn([CLAUDE, "-p", "--model", model, "--no-session-persistence", "--allowedTools", "WebFetch", "--output-format", "json"], {
    stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 600_000);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`);
  const res = JSON.parse(out) as { result: string; is_error?: boolean };
  if (res.is_error) throw new Error(`claude: ${res.result.slice(0, 300)}`);
  return res.result;
}

/** Keeps only well-formed results for ids that were in the batch. */
export function parseResults(text: string, batch: Row[]): Result[] {
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  const byId = new Map(batch.map((r) => [r.platform_id, r.platform]));
  return (JSON.parse(json) as Partial<Result>[]).flatMap((r) => {
    const platform = r.platform_id ? byId.get(r.platform_id) : undefined;
    if (!platform || !r.summary || !SUGGESTIONS.includes(r.suggestion as Suggestion)) return [];
    const tags = (Array.isArray(r.tags) ? r.tags : []).filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().trim()).slice(0, 4);
    return [{ platform, platform_id: r.platform_id!, summary: r.summary.trim(), tags, suggestion: r.suggestion as Suggestion }];
  });
}
