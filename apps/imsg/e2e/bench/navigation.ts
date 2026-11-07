/**
 * Navigation cost: React commits and components rendered when a conversation opens from the list
 * ("open") and when the selection moves from one open conversation to another ("switch").
 *
 *   bun e2e/bench/navigation.ts [--metric open.components] [--names 1] [--cpu 1]
 *
 * One run per invocation, so hillclimb's ab.py can interleave arms. Prints every reading as JSON,
 * then the chosen metric alone on the last line. A reading spans the click to 600 ms after the
 * server's messages painted (`__commaTimings.freshMs`). --names 1 also prints the 25 component
 * names that rendered most and the components each commit's renders began at, readable only in an unminified build (`expo export --no-minify`).
 * --port picks the fixture server, so a control build can serve beside the candidate.
 */
import { chromium, type Page } from "@playwright/test";
import { cachedChromium } from "../chromium";
import { renderCounter, type Renders } from "./renders";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const metric = args.get("metric") ?? "open.components";
const names = args.get("names") === "1";
const cpu = Number(args.get("cpu") ?? 1);
const base = `http://127.0.0.1:${args.get("port") ?? process.env.IMSG_FIXTURE_PORT ?? 8399}`;
const SETTLE_MS = 600;

type Reading = Pick<Renders, "commits" | "components"> & { ms: number; top?: Array<[string, number]>; roots?: Array<[string, number]> };

async function take(page: Page): Promise<Reading> {
  return page.evaluate((withNames) => {
    const w = window as unknown as { __renders: Renders; __renderNames?: Record<string, number>; __renderRoots?: Record<string, number> };
    const reading = {
      commits: w.__renders.commits,
      components: w.__renders.components,
      ms: 0,
      ...(withNames && w.__renderNames
        ? {
            top: Object.entries(w.__renderNames).sort((a, b) => b[1] - a[1]).slice(0, 25),
            roots: Object.entries(w.__renderRoots ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 40),
          }
        : {}),
    };
    for (const key of Object.keys(w.__renders) as Array<keyof Renders>) w.__renders[key] = 0;
    if (w.__renderNames) w.__renderNames = {};
    if (w.__renderRoots) w.__renderRoots = {};
    return reading;
  }, names);
}

/** Clicks the row, waits for the server's messages to paint and settle, and returns what it cost. */
async function openRow(page: Page, name: string): Promise<Reading> {
  const before = await page.evaluate(() => (window as unknown as { __commaTimings: unknown[] }).__commaTimings.length);
  await take(page);
  const row = page.getByTestId("conversation-row").filter({ hasText: name }).first();
  const started = Date.now();
  await row.click();
  await page.waitForFunction((count) => {
    const timings = (window as unknown as { __commaTimings: Array<{ freshMs: number | null }> }).__commaTimings;
    return timings.length > count && timings.at(-1)?.freshMs != null;
  }, before, { timeout: 10_000 });
  const ms = Date.now() - started;
  await page.waitForTimeout(SETTLE_MS);
  return { ...(await take(page)), ms };
}

const reset = await fetch(`${base}/__fixture/reset`, { method: "POST" });
if (!reset.ok) throw new Error(`fixture reset failed: ${reset.status}`);
const browser = await chromium.launch({ executablePath: cachedChromium(), headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage();
  if (cpu > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.addInitScript(renderCounter);
  if (names) await page.addInitScript(() => { Object.assign(window, { __renderNames: {}, __renderRoots: {} }); });
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().waitFor();
  await page.waitForTimeout(SETTLE_MS);
  const open = await openRow(page, "Alex Rivera");
  const switched = await openRow(page, "Jordan Lee");
  const readings = { open, switch: switched };
  console.log(JSON.stringify(readings));
  const [flow, key] = metric.split(".") as ["open" | "switch", keyof Reading];
  console.log(String(readings[flow][key]));
} finally {
  await browser.close();
}
