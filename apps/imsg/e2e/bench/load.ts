/**
 * Load benchmark: cold load to an interactive conversation list, and opening a
 * conversation to its last message on screen. Prints one JSON line per sample and
 * a summary with p50/p75, error count and work count.
 *
 *   bun e2e/bench/load.ts --target fixture --runs 15
 *   bun e2e/bench/load.ts --target prod --runs 9        # read-only: opens via glide preview (j), never marks read
 *   --visit first|return (default return)  --profile tailnet|none (fixture only; default tailnet)
 *
 * Fixture target expects `bun run fixture:start` on IMSG_FIXTURE_PORT (8399).
 * Network is shaped per --profile so fixture numbers resemble the tailnet a user sees.
 */
import { chromium, webkit, type Browser, type Page } from "@playwright/test";
import { cachedChromium } from "../chromium";

type Target = "fixture" | "prod";
interface Sample { run: number; listMs: number | null; openMs: number | null; jsKB: number; error: string | null }

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const target = (args.get("target") ?? "fixture") as Target;
const runs = Number(args.get("runs") ?? 15);
const profile = args.get("profile") ?? "tailnet";
/** first: empty cache and storage. return: a prior visit left the HTTP cache and list snapshot, as a reopened app has. */
const visit = (args.get("visit") ?? "return") as "first" | "return";
/** Idle ms between the list becoming interactive and the open; 0 opens as soon as the list responds. */
const idle = Number(args.get("idle") ?? 0);
/** chromium (web/PWA) or webkit (the desktop shell is a WKWebView). Network shaping is chromium-only. */
const engine = args.get("browser") ?? "chromium";
/** --url points a prod run at a branch preview (same Convex data, read-only flow). */
const base = target === "prod"
  ? args.get("url") ?? "https://milads-mac-mini.taild31e9a.ts.net:8447"
  : `http://127.0.0.1:${process.env.IMSG_FIXTURE_PORT ?? 8399}`;

/** Approximates the laptop-to-Mini tailnet path: ~60 ms RTT, ~40 Mbit down. */
const PROFILES: Record<string, { latency: number; downloadThroughput: number; uploadThroughput: number } | null> = {
  none: null,
  tailnet: { latency: 60, downloadThroughput: 5_000_000, uploadThroughput: 2_500_000 },
};

async function sample(browser: Browser, run: number): Promise<Sample> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (visit === "return") {
    const prime = await context.newPage();
    await prime.goto(base + "/");
    await prime.getByTestId("conversation-row").first().waitFor({ state: "visible", timeout: 30_000 });
    await prime.waitForFunction(() => localStorage.getItem("imsg.chatSnapshot.v1") !== null, undefined, { timeout: 30_000 });
    await prime.close();
  }
  const page = await context.newPage();
  let jsBytes = 0;
  page.on("requestfinished", async (request) => {
    if (!request.url().endsWith(".js")) return;
    jsBytes += (await request.sizes()).responseBodySize;
  });
  const shape = PROFILES[profile];
  if (shape && target === "fixture" && engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...shape });
  }
  if (target === "fixture") {
    const reset = await page.request.post(`${base}/__fixture/reset`);
    if (!reset.ok()) throw new Error("fixture reset failed");
  }
  try {
    await page.goto(base + "/", { waitUntil: "commit" });
    // Navigation start to the first frame with a conversation row whose React handlers are attached.
    const listMs = Number(await (await page.waitForFunction(() => {
      const row = document.querySelector('[data-testid="conversation-row"]');
      if (!row || !Object.keys(row).some((key) => key.startsWith("__reactProps"))) return false;
      return Math.round(performance.now());
    }, undefined, { timeout: 30_000, polling: "raf" })).jsonValue());
    // Correctness gate, not timed: the row really responds to input.
    await page.getByTestId("conversation-row").first().hover();

    if (idle > 0) await page.waitForTimeout(idle);
    const openMs = await openConversation(page);
    return { run, listMs, openMs, jsKB: Math.round(jsBytes / 1024), error: null };
  } catch (cause) {
    return { run, listMs: null, openMs: null, jsKB: Math.round(jsBytes / 1024), error: String(cause).slice(0, 200) };
  } finally {
    await context.close();
  }
}

/**
 * Time from the input to the newest message of a not-yet-opened conversation on screen.
 * Prod opens via glide preview (j), which never marks read; fixture clicks the row, the real gesture.
 */
async function openConversation(page: Page): Promise<number> {
  const rows = page.getByTestId("conversation-row");
  // Nothing is open yet, so the first bubble in the thread pane belongs to this conversation.
  const row = rows.first();
  await row.waitFor({ state: "visible" });
  // Fixture rows are 1:1 with simple names, so "name, [unread,] snippet, time" parses; prod rows do not.
  const label = (await row.getAttribute("aria-label")) ?? "";
  const expected = target === "fixture"
    ? label.split(", ").filter((part) => part !== "unread").slice(1, -1).join(", ").replace(/^You: /, "").slice(0, 24)
    : "";
  if (target === "prod") {
    await page.locator("body").click({ position: { x: 1400, y: 880 } }).catch(() => undefined);
    await page.evaluate(() => {
      (window as unknown as { __benchStart: number }).__benchStart = performance.now();
    });
    await page.keyboard.press("j");
  } else {
    await page.evaluate(() => {
      (window as unknown as { __benchStart: number }).__benchStart = performance.now();
    });
    await row.click();
  }
  // Done when the newest bubble (first in DOM order; the thread is an inverted list) intersects the viewport.
  const newest = await page.waitForFunction(() => {
    const bubble = document.querySelector('[data-testid="thread-view"] [data-testid="message-bubble"]');
    if (!bubble) return false;
    const box = bubble.getBoundingClientRect();
    return box.height > 0 && box.bottom > 0 && box.top < innerHeight ? bubble.textContent ?? "" : false;
  }, undefined, { timeout: 30_000, polling: "raf" });
  const ms = await page.evaluate(() => Math.round(performance.now() - (window as unknown as { __benchStart: number }).__benchStart));
  const text = String(await newest.jsonValue());
  if (target === "fixture" && expected && !text.includes(expected)) throw new Error(`newest bubble is not the row's last message: ${text.slice(0, 40)}`);
  return ms;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const browser = engine === "webkit"
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ executablePath: cachedChromium(), headless: true });
const samples: Sample[] = [];
for (let run = 0; run < runs; run++) {
  const result = await sample(browser, run);
  samples.push(result);
  console.log(JSON.stringify(result));
}
await browser.close();

const ok = samples.filter((s) => s.error === null);
const list = ok.map((s) => s.listMs!);
const open = ok.map((s) => s.openMs!);
console.log(JSON.stringify({
  summary: true, target, engine, profile: engine === "chromium" ? profile : "none", visit, idle, runs, errors: samples.length - ok.length, work: ok.length,
  listP50: percentile(list, 50), listP75: percentile(list, 75), listMin: Math.min(...list), listMax: Math.max(...list),
  openP50: percentile(open, 50), openP75: percentile(open, 75), openMin: Math.min(...open), openMax: Math.max(...open),
  jsKB: ok[0]?.jsKB ?? null,
}));
