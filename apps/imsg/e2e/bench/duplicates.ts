/**
 * Read-only real-data check that the conversation list paginates sanely: each conversation once,
 * and a bounded number of listConversations subscriptions. The fixture's 18 conversations fit in one
 * page, so it cannot catch a pagination loop; run this against a preview before landing list changes.
 *
 *   bun e2e/bench/duplicates.ts [--url https://…] [--seconds 12]
 *
 * Every Convex Mutation and Action frame is dropped before it leaves the page.
 */
import { chromium } from "@playwright/test";
import { cachedChromium } from "../chromium";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const url = args.get("url") ?? "https://milads-mac-mini.taild31e9a.ts.net:8447";
const seconds = Number(args.get("seconds") ?? 12);
/** About 1,100 conversations at 100 per page, plus splits and the first page. */
const MAX_SUBSCRIPTIONS = 80;

const browser = await chromium.launch({ executablePath: cachedChromium() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.routeWebSocket(/convex\.cloud/, (ws) => {
  const server = ws.connectToServer();
  ws.onMessage((message) => { if (!/"type":"(Mutation|Action)"/.test(String(message))) server.send(message); });
  server.onMessage((message) => ws.send(message));
});
const page = await context.newPage();
let subscriptions = 0;
page.on("websocket", (ws) => ws.on("framesent", (frame) => {
  const text = String(frame.payload);
  if (text.includes('"Add"')) subscriptions += (text.match(/listConversations/g) ?? []).length;
}));
await page.goto(url + "/");
await page.getByTestId("conversation-row").first().waitFor({ timeout: 30_000 });
await page.getByRole("tab", { name: "All", exact: true }).click();
await page.waitForTimeout(seconds * 1000);
const labels = await page.getByTestId("conversation-row").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
await browser.close();
const duplicates = labels.length - new Set(labels).size;
console.log(JSON.stringify({ url, rows: labels.length, duplicates, subscriptions, ok: duplicates === 0 && subscriptions <= MAX_SUBSCRIPTIONS }));
process.exit(duplicates === 0 && subscriptions <= MAX_SUBSCRIPTIONS ? 0 : 1);
