/**
 * Convex payload bytes per query in the first N seconds of a cold load (read-only).
 *   bun e2e/bench/queries.ts [--url https://…] [--seconds 8]
 */
import { chromium } from "@playwright/test";
import { cachedChromium } from "../chromium";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const url = args.get("url") ?? "https://milads-mac-mini.taild31e9a.ts.net:8447";
const seconds = Number(args.get("seconds") ?? 8);

const browser = await chromium.launch({ executablePath: cachedChromium() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const t0 = Date.now();
const names = new Map<number, string>();
const totals = new Map<string, { updates: number; bytes: number; firstMs: number }>();
page.on("websocket", (ws) => {
  ws.on("framesent", (frame) => {
    const message = JSON.parse(String(frame.payload)) as { type: string; modifications?: Array<{ type: string; queryId: number; udfPath: string; args: Array<{ paginationOpts?: { numItems: number } }> }> };
    if (message.type !== "ModifyQuerySet") return;
    for (const mod of message.modifications ?? []) {
      if (mod.type === "Add") names.set(mod.queryId, mod.udfPath + (mod.args[0]?.paginationOpts ? `(n=${mod.args[0].paginationOpts.numItems})` : ""));
    }
  });
  ws.on("framereceived", (frame) => {
    const message = JSON.parse(String(frame.payload)) as { type: string; modifications?: Array<{ type: string; queryId: number; value: unknown }> };
    if (message.type !== "Transition") return;
    for (const mod of message.modifications ?? []) {
      if (mod.type !== "QueryUpdated") continue;
      const name = names.get(mod.queryId) ?? `query#${mod.queryId}`;
      const entry = totals.get(name) ?? { updates: 0, bytes: 0, firstMs: Date.now() - t0 };
      entry.updates++;
      entry.bytes += JSON.stringify(mod.value).length;
      totals.set(name, entry);
    }
  });
});
await page.goto(url);
await page.getByTestId("conversation-row").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(seconds * 1000);
await browser.close();
const rows = [...totals].sort((a, b) => b[1].bytes - a[1].bytes);
for (const [name, entry] of rows) console.log(`${String(Math.round(entry.bytes / 1024)).padStart(6)} KB  x${entry.updates}  first ${entry.firstMs} ms  ${name}`);
console.log(JSON.stringify({ summary: true, url, seconds, totalKB: Math.round(rows.reduce((sum, [, e]) => sum + e.bytes, 0) / 1024) }));
