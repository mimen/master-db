/**
 * One cold load, then a read-only glide open (j): timestamps for socket Connect, list and thread
 * query adds and replies, list interactive, and the first bubble.
 *   bun e2e/bench/trace-open.ts <url> [return|first]
 */
import { chromium } from "@playwright/test";
import { cachedChromium } from "../chromium";

const url = Bun.argv[2];
const visit = Bun.argv[3] ?? "return";
const browser = await chromium.launch({ executablePath: cachedChromium() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
if (visit === "return") {
  const prime = await context.newPage();
  await prime.goto(url + "/");
  await prime.getByTestId("conversation-row").first().waitFor();
  await prime.waitForFunction(() => localStorage.getItem("imsg.chatSnapshot.v1") !== null);
  await prime.close();
}
const page = await context.newPage();
const t0 = Date.now();
const log = (s: string) => console.log(String(Date.now() - t0).padStart(5), s);
const names = new Map<number, string>();
page.on("websocket", (ws) => {
  ws.on("framesent", (f) => {
    const m = JSON.parse(String(f.payload)) as { type: string; modifications?: Array<{ type: string; queryId: number; udfPath: string; args: Array<{ paginationOpts?: { numItems: number } }> }> };
    if (m.type === "Connect") log("sent Connect");
    if (m.type !== "ModifyQuerySet") return;
    for (const mod of m.modifications ?? []) if (mod.type === "Add") {
      const n = mod.udfPath + (mod.args[0]?.paginationOpts ? `(n=${mod.args[0].paginationOpts.numItems})` : "");
      names.set(mod.queryId, n);
      if (/listMessages|listConversations|messageWindow/.test(n)) log(`add ${n}`);
    }
  });
  ws.on("framereceived", (f) => {
    const m = JSON.parse(String(f.payload)) as { type: string; modifications?: Array<{ type: string; queryId: number }> };
    if (m.type !== "Transition") return;
    const hit = (m.modifications ?? []).map((x) => names.get(x.queryId) ?? "").filter((n) => /listMessages|listConversations|messageWindow/.test(n));
    if (hit.length) log(`recv ${Math.round(String(f.payload).length / 1024)}KB ${hit.join(",")}`);
  });
});
await page.goto(url + "/", { waitUntil: "commit" });
await page.waitForFunction(() => {
  const row = document.querySelector('[data-testid="conversation-row"]');
  return row && Object.keys(row).some((k) => k.startsWith("__reactProps"));
}, undefined, { polling: "raf" });
log("list interactive");
await page.getByTestId("conversation-row").first().hover();
await page.locator("body").click({ position: { x: 1400, y: 880 } });
log("press j");
await page.keyboard.press("j");
await page.waitForFunction(() => document.querySelector('[data-testid="thread-view"] [data-testid="message-bubble"]'), undefined, { polling: "raf" });
log("bubble");
await page.waitForTimeout(800);
await browser.close();
