/**
 * Layout-shift census: every Layout Instability `layout-shift` entry not caused by input,
 * attributed to a named region and a phase. CLS hides small shifts; this counts them.
 *
 *   bun e2e/bench/shift.ts --target fixture --runs 5 [--visit first|return] [--hold 1500]
 *
 * `--hold` withholds the conversation list (fixture only) for that many ms after first paint,
 * so data arriving late must not move what is already on screen.
 * Flows: cold load, then open the first conversation, then idle 1.5 s.
 */
import { chromium, type Page } from "@playwright/test";
import { cachedChromium } from "../chromium";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const target = args.get("target") ?? "fixture";
const runs = Number(args.get("runs") ?? 5);
const visit = args.get("visit") ?? "first";
const hold = Number(args.get("hold") ?? 0);
const width = Number(args.get("width") ?? 1440);
const base = target === "prod"
  ? "https://milads-mac-mini.taild31e9a.ts.net:8447"
  : `http://127.0.0.1:${process.env.IMSG_FIXTURE_PORT ?? 8399}`;

/** Ordered outermost-last: a source is named by the first region containing it. */
const REGIONS = ["conversation-row", "thread-message-list", "state-strip", "thread-view", "conversation-list-scroll", "triage-queue-header"];

interface Shift { phase: string; region: string; value: number; node: string }

const census = (regions: string[]) => {
  const target = window as unknown as { __shifts: Shift[]; __phase: string };
  target.__shifts = [];
  target.__phase = "boot";
  const name = (node: Node | null): string => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    if (!el) return "unknown";
    for (const region of regions) if (el.closest(`[data-testid="${region}"]`)) return region;
    return "other";
  };
  const describe = (node: Node | null): string => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    if (!el) return "?";
    const id = el.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
    return `${el.tagName.toLowerCase()}${id ? `@${id}` : ""}`;
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null }> }>) {
      if (entry.hadRecentInput) continue;
      const sources = entry.sources?.length ? entry.sources : [{ node: null }];
      for (const source of sources) target.__shifts.push({ phase: target.__phase, region: name(source.node), value: entry.value, node: describe(source.node) });
    }
  }).observe({ type: "layout-shift", buffered: true });
};

async function phase(page: Page, value: string): Promise<void> {
  await page.evaluate((next) => { (window as unknown as { __phase: string }).__phase = next; }, value);
}

const browser = await chromium.launch({ executablePath: cachedChromium(), headless: true });
const all: Shift[][] = [];
for (let run = 0; run < runs; run++) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  if (target === "fixture") await context.request.post(`${base}/__fixture/reset`);
  if (visit === "return") {
    const prime = await context.newPage();
    await prime.goto(base + "/");
    await prime.waitForFunction(() => localStorage.getItem("imsg.chatSnapshot.v1") !== null, undefined, { timeout: 30_000 });
    await prime.close();
  }
  const page = await context.newPage();
  await page.addInitScript(census, REGIONS);
  if (hold > 0 && target === "fixture") {
    let painted = false;
    page.on("framenavigated", () => { painted = false; });
    await page.route("**/__fixture/convex", async (route) => {
      const body = route.request().postDataJSON() as { name: string };
      if (body.name === "comma/queries:listConversations" && !painted) {
        painted = true;
        await new Promise((resolve) => setTimeout(resolve, hold));
      }
      await route.continue();
    });
  }
  await page.goto(base + "/", { waitUntil: "commit" });
  await page.getByTestId("conversation-row").first().waitFor({ state: "visible", timeout: 30_000 });
  await phase(page, "list-settling");
  await page.waitForTimeout(2000);
  await phase(page, "open");
  if (target === "prod") {
    await page.locator("body").click({ position: { x: width - 40, y: 880 } }).catch(() => undefined);
    await phase(page, "open");
    await page.keyboard.press("j");
  } else {
    await page.getByTestId("conversation-row").first().click();
  }
  await page.getByTestId("thread-view").getByTestId("message-bubble").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1500);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  all.push(shifts);
  console.log(JSON.stringify({ run, count: shifts.length, shifts: shifts.map((s) => `${s.phase}:${s.region}:${s.node}:${s.value.toFixed(4)}`) }));
  await context.close();
}
await browser.close();
const counts = all.map((s) => s.length).sort((a, b) => a - b);
const byRegion: Record<string, number> = {};
for (const shift of all.flat()) byRegion[`${shift.phase}:${shift.region}`] = (byRegion[`${shift.phase}:${shift.region}`] ?? 0) + 1;
console.log(JSON.stringify({ summary: true, target, visit, hold, width, runs, shiftsMedian: counts[Math.floor(counts.length / 2)], shiftsMax: counts.at(-1), byRegion }));
