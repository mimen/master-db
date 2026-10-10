/**
 * Optimistic-interaction benchmark: ms from an input event to the first animation frame in which
 * the expected visible change is in the DOM. Prints one JSON line per sample and a summary per
 * case and target with p50/p75, error count and work count.
 *
 *   bun e2e/bench/optimistic.ts --runs 9
 *   bun e2e/bench/optimistic.ts --runs 9 --url http://127.0.0.1:8641,http://127.0.0.1:8642   # interleaved A/B
 *   --case tapback-add|tapback-remove|unsend (default all)  --profile tailnet|none (default tailnet)
 *
 * Expects a fixture server (`bun run fixture:start`) on IMSG_FIXTURE_PORT (8399) unless --url names one.
 * Each sample resets the fixture world. To add a case, append to CASES: `setup` brings the page
 * to the moment before the input (untimed), `act` dispatches the input, and `done` runs in the page
 * every frame until the change is visible.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { cachedChromium } from "../chromium";
import { FIXTURE_NOW } from "../fixture/world";

interface Sample { case: string; target: string; run: number; ms: number | null; error: string | null }
interface Case {
  name: string;
  setup(page: Page): Promise<void>;
  act(page: Page): Promise<void>;
  /** Evaluated in the page once per animation frame; true once the change is on screen. */
  done: () => boolean;
}

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const runs = Number(args.get("runs") ?? 9);
const profile = args.get("profile") ?? "tailnet";
const only = args.get("case");
const targets = (args.get("url") ?? `http://127.0.0.1:${process.env.IMSG_FIXTURE_PORT ?? 8399}`).split(",");

/** Same tailnet approximation as load.ts: ~60 ms RTT, ~40 Mbit down. */
const PROFILES: Record<string, { latency: number; downloadThroughput: number; uploadThroughput: number } | null> = {
  none: null,
  tailnet: { latency: 60, downloadThroughput: 5_000_000, uploadThroughput: 2_500_000 },
};

const INBOUND = "Can you send the final arrival time?";
const thread = (page: Page) => page.getByTestId("thread-view");
const inbound = (page: Page) => thread(page).getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
const tray = (page: Page) => page.getByRole("toolbar", { name: "Tapbacks" });

/** The Like badge under a bubble, not the Like button in the open tray. */
function likeBadgeShown(): boolean {
  return [...document.querySelectorAll('[data-testid="thread-view"] [aria-label="Like"]')]
    .some((element) => !element.closest('[role="toolbar"]'));
}

async function openAlex(page: Page): Promise<void> {
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await inbound(page).waitFor({ state: "visible", timeout: 30_000 });
}

const UNSEND_TEXT = "bench unsend probe";

const CASES: Case[] = [
  {
    name: "tapback-add",
    setup: async (page) => {
      await openAlex(page);
      await inbound(page).click({ button: "right" });
      await tray(page).waitFor();
    },
    act: (page) => tray(page).getByRole("button", { name: "Like", exact: true }).click(),
    done: likeBadgeShown,
  },
  {
    name: "tapback-remove",
    setup: async (page) => {
      await openAlex(page);
      await inbound(page).click({ button: "right" });
      await tray(page).getByRole("button", { name: "Like", exact: true }).click();
      // Removal starts from a reaction the server already holds, not from an overlay.
      await page.waitForFunction(likeBadgeShown, undefined, { polling: "raf", timeout: 10_000 });
      await page.waitForTimeout(1_500);
      await inbound(page).click({ button: "right" });
      await tray(page).getByRole("button", { name: "Remove Like" }).waitFor();
    },
    act: (page) => tray(page).getByRole("button", { name: "Remove Like" }).click(),
    done: () => ![...document.querySelectorAll('[data-testid="thread-view"] [aria-label="Like"]')]
      .some((element) => !element.closest('[role="toolbar"]')),
  },
  {
    // Seeded fixture messages are older than the 2-minute Undo send window; a fresh send is not.
    name: "unsend",
    setup: async (page) => {
      await openAlex(page);
      const composer = page.getByPlaceholder("iMessage");
      await composer.fill(UNSEND_TEXT);
      await composer.press("Enter");
      const bubble = thread(page).getByRole("button", { name: `You: ${UNSEND_TEXT}` });
      await bubble.waitFor();
      await page.waitForTimeout(1_500);
      await bubble.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Undo send" }).waitFor();
    },
    act: (page) => page.getByRole("menuitem", { name: "Undo send" }).click(),
    done: () => ![...document.querySelectorAll('[data-testid="thread-view"] [role="button"]')]
      .some((element) => element.getAttribute("aria-label") === "You: bench unsend probe"),
  },
].filter((c) => !only || c.name === only);

async function sample(browser: Browser, base: string, benchCase: Case, run: number): Promise<Sample> {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
  const page = await context.newPage();
  // The fixture stamps sends on its pinned clock; match it so Edit and Undo send windows apply.
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  try {
    const reset = await page.request.post(`${base}/__fixture/reset`);
    if (!reset.ok()) throw new Error("fixture reset failed");
    const shape = PROFILES[profile];
    if (shape) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...shape });
    }
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await benchCase.setup(page);
    // The input's own timestamp, taken in the page on the first pointer or key event after arming.
    await page.evaluate(() => {
      const bench = window as unknown as { __inputAt?: number };
      delete bench.__inputAt;
      const mark = (event: Event) => { bench.__inputAt ??= event.timeStamp; };
      for (const type of ["pointerdown", "keydown"]) addEventListener(type, mark, { capture: true, once: true });
    });
    // Armed before the input so the first matching frame is the one that counts.
    const visible = page.waitForFunction(`(${benchCase.done.toString()})() && performance.now()`, undefined, { polling: "raf", timeout: 15_000 });
    await benchCase.act(page);
    const seenAt = Number(await (await visible).jsonValue());
    const inputAt = await page.evaluate(() => (window as unknown as { __inputAt?: number }).__inputAt);
    if (inputAt === undefined) throw new Error("input event never reached the page");
    return { case: benchCase.name, target: base, run, ms: Math.round(seenAt - inputAt), error: null };
  } catch (cause) {
    return { case: benchCase.name, target: base, run, ms: null, error: String(cause).slice(0, 200) };
  } finally {
    await context.close();
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const browser = await chromium.launch({ executablePath: cachedChromium(), headless: true });
const samples: Sample[] = [];
for (let run = 0; run < runs; run++) {
  for (const benchCase of CASES) {
    for (const base of targets) {
      const result = await sample(browser, base, benchCase, run);
      samples.push(result);
      console.log(JSON.stringify(result));
    }
  }
}
await browser.close();

for (const benchCase of CASES) {
  for (const base of targets) {
    const mine = samples.filter((s) => s.case === benchCase.name && s.target === base);
    const ok = mine.filter((s) => s.error === null).map((s) => s.ms!);
    console.log(JSON.stringify({
      summary: true, case: benchCase.name, target: base, profile, runs, errors: mine.length - ok.length, work: ok.length,
      p50: percentile(ok, 50), p75: percentile(ok, 75), min: Math.min(...ok), max: Math.max(...ok),
    }));
  }
}
