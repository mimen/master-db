import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BrowserContext, Locator, Page } from "@playwright/test";

// The script lives outside apps/imsg, so resolve Playwright from the cwd (apps/imsg), not from this file.
const { webkit } = createRequire(join(process.cwd(), "package.json"))("@playwright/test") as typeof import("@playwright/test");

const URL = "https://milads-mac-mini.taild31e9a.ts.net:8447";
const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    only: { type: "string" },
    reps: { type: "string", default: "5" },
    conversations: { type: "string", default: "Sprout Imen,Andrew Wilkinson" },
  },
});
if (import.meta.main && !args.out) throw new Error("usage: webkit-proxy.ts --out <dir> [--reps 5] [--conversations \"A,B\"]");
const OUT = resolve(args.out ?? ".");
const REPS = Number(args.reps);
const [NAME_A, NAME_B] = args.conversations!.split(",").map((s) => s.trim());
const SELF_ALIASES = ["Sprout Imen", "(925) 997-6370", "+1 925-997-6370"];
const QUIET_MS = 300;
const CAP_MS = 5000;

type Stat = { median: number; p90: number; samples: number[]; capped?: number };
type Result = {
  id: string;
  app: "comma-webkit";
  reps: number;
  firstResponseMs: Stat;
  doubleRafMs?: Stat;
  settledMs: Stat;
  scroll?: { gapsOver16: number; gapsOver33: number; p90FrameMs: number; frames: number };
  longFrames?: number;
  convex?: { messagesMedian: number; lastMessageMsMedian: number };
  notes?: string[];
};
type Sample = {
  firstResponse: number | null;
  doubleRaf: number | null;
  settled: number;
  capped: boolean;
  longFrames: number;
  wsIn: number;
  wsLast: number | null;
  modifyQuerySet: number;
  scrollIntervals: number[];
};
type Analysis = { done: false } | ({ done: true } & Sample);

const recorder = (): void => {
  const L = {
    frames: [] as number[],
    muts: [] as number[],
    scrolls: [] as number[],
    edits: [] as number[],
    inputs: [] as { type: string; t: number }[],
    wsIn: [] as number[],
    mqs: [] as number[],
  };
  (window as unknown as { __lat: typeof L }).__lat = L;
  const loop = (): void => {
    L.frames.push(performance.now());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  new MutationObserver(() => L.muts.push(performance.now())).observe(document, {
    subtree: true, childList: true, attributes: true, characterData: true,
  });
  const MODIFIERS = new Set(["Meta", "Shift", "Control", "Alt"]);
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    addEventListener(type, (e) => {
      if (e instanceof KeyboardEvent && MODIFIERS.has(e.key)) return;
      L.inputs.push({ type, t: e.timeStamp });
    }, { capture: true, passive: true });
  }
  addEventListener("scroll", () => L.scrolls.push(performance.now()), { capture: true, passive: true });
  // A typed glyph changes the input's value property, which MutationObserver cannot see.
  addEventListener("input", () => L.edits.push(performance.now()), { capture: true, passive: true });
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("message", () => L.wsIn.push(performance.now()));
    }
    override send(data: Parameters<WebSocket["send"]>[0]): void {
      if (typeof data === "string" && data.includes("\"ModifyQuerySet\"")) L.mqs.push(performance.now());
      super.send(data);
    }
  };
};

const tauriStandIn = (): void => {
  let fullscreen = false;
  const resized = new Set<() => void>();
  const currentWindow = {
    close: async (): Promise<void> => undefined,
    isFullscreen: async (): Promise<boolean> => fullscreen,
    onResized: async (handler: () => void): Promise<() => void> => {
      resized.add(handler);
      return () => {
        resized.delete(handler);
      };
    },
  };
  const target = window as Window & {
    __fixtureHasFullscreenListener?: () => boolean;
    __fixtureSetFullscreen?: (value: boolean) => void;
    __TAURI__?: {
      event: { listen: () => Promise<() => void> };
      window: { getCurrentWindow: () => typeof currentWindow };
    };
  };
  Object.defineProperty(target, "__IMSG_NATIVE_SHELL__", { value: true, enumerable: true });
  target.__fixtureHasFullscreenListener = (): boolean => resized.size > 0;
  target.__fixtureSetFullscreen = (value: boolean): void => {
    fullscreen = value;
    for (const handler of resized) handler();
  };
  target.__TAURI__ = {
    event: { listen: async () => () => undefined },
    window: { getCurrentWindow: () => currentWindow },
  };
};

export function analyze({ mark, inputIndex, scroll, quiet, cap }: { mark: number; inputIndex: number; scroll: boolean; quiet: number; cap: number }): Analysis {
  const L = (window as unknown as {
    __lat: { frames: number[]; muts: number[]; scrolls: number[]; edits: number[]; inputs: { t: number }[]; wsIn: number[]; mqs: number[] };
  }).__lat;
  const now = performance.now();
  // Index, not timestamp: WebKit clamps both clocks to whole milliseconds, so a key can share the mark's ms.
  const t0 = L.inputs[inputIndex]?.t;
  if (t0 === undefined) return now - mark > cap ? { done: true, firstResponse: null, doubleRaf: null, settled: cap, capped: true, longFrames: 0, wsIn: 0, wsLast: null, modifyQuerySet: 0, scrollIntervals: [] } : { done: false };
  const after = (xs: number[], t: number): number[] => xs.filter((x) => x >= t);
  const scrolls = after(L.scrolls, t0);
  const activity = [...after(L.muts, t0), ...after(L.edits, t0), ...(scroll ? scrolls : [])].sort((a, b) => a - b);
  // Incoming WS frames count toward quiet so a query still streaming results is not mistaken for settled.
  const ws = after(L.wsIn, t0);
  const lastInput = L.inputs[L.inputs.length - 1]?.t ?? t0;
  const lastActivity = Math.max(t0, lastInput, ...activity, ...ws);
  const settleAt = activity.length && now - lastActivity >= quiet ? lastActivity : null;
  const capped = settleAt === null && now - t0 >= cap;
  if (settleAt === null && !capped) return { done: false };
  const end = settleAt ?? t0 + cap;
  const frameAfter = (t: number, nth = 0): number | null => after(L.frames, t)[nth] ?? null;
  const first = scroll ? scrolls[0] : activity[0];
  const f1 = first === undefined ? null : frameAfter(first);
  const f2 = first === undefined ? null : frameAfter(first, 1);
  const settledFrame = frameAfter(end) ?? end;
  const span = L.frames.filter((f) => f >= t0 && f <= settledFrame);
  const intervals = span.slice(1).map((f, i) => f - span[i]);
  const wsSettled = ws.filter((t) => t <= settledFrame);
  const scrollSpan = scrolls.length ? L.frames.filter((f) => f >= scrolls[0] && f <= scrolls[scrolls.length - 1]) : [];
  return {
    done: true,
    firstResponse: f1 === null ? null : f1 - t0,
    doubleRaf: f2 === null ? null : f2 - t0,
    settled: settledFrame - t0,
    capped,
    longFrames: intervals.filter((d) => d > 50).length,
    wsIn: wsSettled.length,
    wsLast: wsSettled.length ? wsSettled[wsSettled.length - 1] - t0 : null,
    modifyQuerySet: L.mqs.filter((t) => t >= t0 && t <= settledFrame).length,
    scrollIntervals: scroll ? scrollSpan.slice(1).map((f, i) => f - scrollSpan[i]) : [],
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const round = (n: number): number => Math.round(n * 10) / 10;
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : 0;
};
const stat = (xs: number[], capped?: number): Stat => ({
  median: round(pct(xs, 0.5)), p90: round(pct(xs, 0.9)), samples: xs.map(round), ...(capped ? { capped } : {}),
});

async function measure(page: Page, act: () => Promise<void>, scroll = false): Promise<Sample> {
  const { mark, inputIndex } = await page.evaluate(() => ({
    mark: performance.now(),
    inputIndex: (window as unknown as { __lat: { inputs: unknown[] } }).__lat.inputs.length,
  }));
  await act();
  for (;;) {
    const a = await page.evaluate(analyze, { mark, inputIndex, scroll, quiet: QUIET_MS, cap: CAP_MS });
    if (a.done) return a;
    await sleep(50);
  }
}

async function settle(page: Page): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < CAP_MS) {
    const idle = await page.evaluate((quiet) => {
      const muts = (window as unknown as { __lat: { muts: number[] } }).__lat.muts;
      return performance.now() - (muts[muts.length - 1] ?? 0) >= quiet;
    }, QUIET_MS);
    if (idle) return;
    await sleep(50);
  }
}

function press(page: Page, combo: string): Promise<void> {
  if (/enter|return/i.test(combo)) throw new Error(`refusing to press ${combo}`);
  return page.keyboard.press(combo);
}

function typeChar(page: Page, ch: string): Promise<void> {
  if (ch.length !== 1 || ch === "\n" || ch === "\r") throw new Error(`refusing to type ${JSON.stringify(ch)}`);
  return page.keyboard.type(ch);
}

async function wheel(page: Page, target: Locator, total: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("scroll target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const step = Math.sign(total) * 24;
  for (let moved = 0; Math.abs(moved) < Math.abs(total); moved += step) {
    await page.mouse.wheel(0, step);
    await sleep(8);
  }
}

function toResult(id: string, samples: Sample[], notes: string[] = []): Result {
  const firsts = samples.map((s) => s.firstResponse).filter((x): x is number => x !== null);
  const doubles = samples.map((s) => s.doubleRaf).filter((x): x is number => x !== null);
  const missing = samples.length - firsts.length;
  const intervals = samples.flatMap((s) => s.scrollIntervals);
  const lasts = samples.map((s) => s.wsLast).filter((x): x is number => x !== null);
  const mqs = samples.map((s) => s.modifyQuerySet);
  return {
    id,
    app: "comma-webkit",
    reps: samples.length,
    firstResponseMs: stat(firsts),
    doubleRafMs: stat(doubles),
    settledMs: stat(samples.map((s) => s.settled), samples.filter((s) => s.capped).length),
    ...(intervals.length ? {
      scroll: {
        gapsOver16: intervals.filter((d) => d > 16.7).length,
        gapsOver33: intervals.filter((d) => d > 33).length,
        p90FrameMs: round(pct(intervals, 0.9)),
        frames: intervals.length + 1,
      },
    } : {}),
    longFrames: samples.reduce((n, s) => n + s.longFrames, 0),
    convex: { messagesMedian: pct(samples.map((s) => s.wsIn), 0.5), lastMessageMsMedian: round(pct(lasts, 0.5)) },
    notes: [
      `ModifyQuerySet sent between input and settle: median ${pct(mqs, 0.5)}, total ${mqs.reduce((a, b) => a + b, 0)}`,
      ...(missing ? [`${missing} sample(s) saw no DOM response before settle`] : []),
      ...notes,
    ],
  };
}

async function findRow(page: Page, names: string[]): Promise<Locator> {
  const list = page.getByTestId("conversation-list-scroll");
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const name of names) {
      const row = page.getByTestId("conversation-row").filter({ hasText: name }).first();
      if (await row.count()) {
        await row.scrollIntoViewIfNeeded();
        return row;
      }
    }
    await wheel(page, list, attempt === 0 ? -20000 : 800);
    await sleep(150);
  }
  throw new Error(`conversation row not found: ${names.join(" / ")}`);
}

async function lensTabs(page: Page): Promise<{ label: string; tab: Locator }[]> {
  const all = page.locator("[aria-label=\"Conversation state\"] [role=radio], [role=tablist] [role=tab]");
  const found: { label: string; tab: Locator }[] = [];
  for (let i = 0; i < await all.count(); i++) {
    const tab = all.nth(i);
    const label = (await tab.getAttribute("aria-label")) ?? (await tab.innerText());
    if (/^(Needs reply|Unread|Waiting|All)\b/.test(label)) found.push({ label, tab });
  }
  return found;
}

const isSelected = async (tab: Locator): Promise<boolean> =>
  (await tab.getAttribute("aria-checked")) === "true" || (await tab.getAttribute("aria-selected")) === "true";

async function main(): Promise<void> {
  mkdirSync(join(OUT, "webkit"), { recursive: true });
  const notes: string[] = [
    "WebKit has no Long Tasks API or Event Timing; longFrames counts rAF intervals over 50ms between input and settle as the proxy.",
    "firstResponseMs is input event.timeStamp to the first rAF after the first DOM mutation (scroll: first scroll event); doubleRafMs is the second rAF.",
    `settledMs is input to the rAF after the last mutation followed by ${QUIET_MS}ms of quiet, capped at ${CAP_MS}ms.`,
    "scroll gap counts and frames are totals across reps; p90FrameMs is over all rAF intervals during scrolling.",
    "Headless WebKit paints offscreen, so rAF timing is a proxy for, not a measure of, input-to-photon.",
  ];
  const browser = await webkit.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 860 },
    recordVideo: { dir: join(OUT, "webkit"), size: { width: 1280, height: 860 } },
  });
  let droppedMutations = 0;
  let droppedMarkRead = 0;
  let blockedRequests = 0;
  const wsUrls = new Set<string>();

  if (typeof context.routeWebSocket !== "function") throw new Error("routeWebSocket unavailable; refusing to run without the mutation guard");
  await context.route("**/*", (route) => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
    blockedRequests++;
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (ws) => {
    wsUrls.add(ws.url());
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      let type: unknown;
      try {
        type = typeof message === "string" ? (JSON.parse(message) as { type?: unknown }).type : undefined;
      } catch {
        type = undefined;
      }
      if (type === undefined || type === "Mutation" || type === "Action") {
        droppedMutations++;
        if (typeof message === "string" && message.includes("markRead")) droppedMarkRead++;
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  await context.addInitScript(tauriStandIn);
  await context.addInitScript(recorder);

  const page = await context.newPage();
  const startedAt = new Date().toISOString();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").first().waitFor({ timeout: 30_000 });
  if (![...wsUrls].some((u) => u.includes(".convex.cloud"))) {
    await sleep(3000);
    if (![...wsUrls].some((u) => u.includes(".convex.cloud"))) throw new Error(`Convex WebSocket not proxied (saw ${[...wsUrls].join(", ") || "none"}); aborting before any interaction`);
  }
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const results: Result[] = [];
  const shot = (id: string): Promise<Buffer> => page.screenshot({ path: join(OUT, "webkit", `${id}.png`) });
  const run = async (id: string, fn: () => Promise<Result>): Promise<void> => {
    if (args.only && !args.only.split(",").includes(id)) return;
    try {
      results.push(await fn());
      await shot(id);
    } catch (error) {
      notes.push(`${id} failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
    console.log(`${id} done`, notes.filter((n) => n.startsWith(id)).join("; "));
  };

  const tabs = await lensTabs(page);
  const originalLens = (await Promise.all(tabs.map(async (t) => (await isSelected(t.tab)) ? t : null))).find(Boolean) ?? null;
  const allTab = tabs.find((t) => t.label.startsWith("All"));
  if (allTab && !(await isSelected(allTab.tab))) {
    await allTab.tab.click();
    await settle(page);
  }
  if (!allTab) notes.push("All lens tab not found; ran in the current lens");

  const aNames = NAME_A === "Sprout Imen" ? SELF_ALIASES : [NAME_A];
  const openA = async (): Promise<Locator> => findRow(page, aNames);
  const openB = async (): Promise<Locator> => findRow(page, [NAME_B]);

  if (args.only === "preview.switch") await run("preview.switch", async () => {
    if (!allTab) throw new Error("All lens unavailable");
    await allTab.tab.click();
    await settle(page);
    const before = droppedMarkRead;
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) samples.push(await measure(page, () => press(page, i % 2 === 0 ? "j" : "k")));
    await settle(page);
    const marks = droppedMarkRead - before;
    if (marks !== 0) throw new Error(`preview attempted ${marks} markRead writes`);
    return toResult("preview.switch", samples, ["j/k keyboard previews, not mouse conversation clicks", `markRead attempts during preview: ${marks}`]);
  });

  await run("conversation.switch", async () => {
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      for (const open of [openB, openA]) {
        const row = await open();
        samples.push(await measure(page, () => row.click()));
      }
    }
    return toResult("conversation.switch", samples, [`alternates ${NAME_B} and ${NAME_A}; ${samples.length} samples`]);
  });

  await run("conversation.rapid-switch", async () => {
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      await (await openA()).click();
      await settle(page);
      const b = await openB();
      const a = await openA();
      await b.click();
      await sleep(80);
      samples.push(await measure(page, () => a.click()));
    }
    return toResult("conversation.rapid-switch", samples, ["measured from the second click (A), 80ms after clicking B"]);
  });

  const scrollRun = async (id: string, testId: string): Promise<void> => run(id, async () => {
    const target = page.getByTestId(testId).first();
    await target.waitFor();
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      samples.push(await measure(page, async () => {
        await wheel(page, target, i % 2 === 0 ? 384 : -384);
      }, true));
    }
    return toResult(id, samples, ["16 wheel pulses of 24px, alternating direction by repetition, at ~8ms"]);
  });
  await scrollRun("list.scroll", "conversation-list-scroll");
  await (await openA()).click();
  await settle(page);
  await scrollRun("thread.scroll", "thread-message-list");

  await run("search.type", async () => {
    const field = page.getByLabel("Search conversations and messages").first();
    if ((await field.inputValue()) !== "") throw new Error("search field already has text; left untouched");
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      await field.click();
      try {
        for (const ch of "a") samples.push(await measure(page, () => typeChar(page, ch)));
        await shot("search.type");
      } finally {
        const current = await field.inputValue();
        if (!["", "a", "an"].includes(current)) throw new Error("search text changed outside harness; preserved");
        await field.fill("");
        if ((await field.inputValue()) !== "") throw new Error("search field not empty after clearing");
      }
      await settle(page);
    }
    return toResult("search.type", samples, ["per keystroke of \"a\"; field cleared and verified empty after each rep"]);
  });

  await run("compose.type", async () => {
    const selfRow = await findRow(page, SELF_ALIASES);
    const selfText = await selfRow.innerText();
    if (!SELF_ALIASES.some((name) => selfText.split("\n").some((line) => line.trim() === name))) throw new Error("self row identity not exact; refused compose test");
    await selfRow.click();
    await settle(page);
    const composer = page.getByPlaceholder("iMessage").first();
    if ((await composer.inputValue()) !== "") throw new Error("composer already has a draft; left untouched");
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      await composer.click();
      try {
        for (const ch of "abc") samples.push(await measure(page, () => typeChar(page, ch)));
        await shot("compose.type");
      } finally {
        const current = await composer.inputValue();
        if (!["", "a", "ab", "abc"].includes(current)) throw new Error("composer text changed outside harness; preserved");
        await composer.fill("");
        if ((await composer.inputValue()) !== "") throw new Error("composer not empty after clearing");
      }
      await settle(page);
    }
    return toResult("compose.type", samples, [`self chat (${SELF_ALIASES.join(" / ")}); per key of "abc"; cleared and verified empty after each rep`]);
  });

  await run("lens.switch", async () => {
    const present = (await lensTabs(page)).filter((tab) => /^(Waiting|All)\b/.test(tab.label));
    if (present.length < 2) throw new Error(`need 2+ lens tabs, found ${present.length}`);
    const samples: Sample[] = [];
    let current = (await Promise.all(present.map((t) => isSelected(t.tab)))).indexOf(true);
    for (let i = 0; i < REPS * (present.length - 1); i++) {
      current = (current + 1) % present.length;
      samples.push(await measure(page, () => present[current].tab.click()));
    }
    return toResult("lens.switch", samples, [`cycled ${present.map((t) => t.label).join(" | ")}`]);
  });
  if (allTab && !(await isSelected(allTab.tab))) {
    await allTab.tab.click();
    await settle(page);
  }

  await run("details.toggle", async () => {
    await (await openA()).click();
    await settle(page);
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      samples.push(await measure(page, () => press(page, "Meta+i")));
      await shot("details.toggle");
      await press(page, "Meta+i");
      await settle(page);
    }
    return toResult("details.toggle", samples, ["measures ⌘I open; close is unmeasured"]);
  });

  await run("palette.open", async () => {
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      samples.push(await measure(page, () => press(page, "Meta+k")));
      await page.getByLabel("Search or jump to").waitFor({ timeout: 2000 });
      await shot("palette.open");
      await press(page, "Escape");
      await settle(page);
    }
    return toResult("palette.open", samples, ["measures ⌘K; Escape closes, unmeasured"]);
  });

  await (await openA()).click();
  await settle(page);
  const searchValue = await page.getByLabel("Search conversations and messages").first().inputValue().catch(() => "?");
  const composerValue = await page.getByPlaceholder("iMessage").first().inputValue().catch(() => "?");
  notes.push(`end state: search field ${JSON.stringify(searchValue)}, self-chat composer ${JSON.stringify(composerValue)}`);
  const restore = originalLens ?? allTab;
  if (restore && !(await isSelected(restore.tab))) {
    await restore.tab.click();
    await settle(page);
  }
  notes.push(`lens restored to ${restore?.label ?? "unknown"}`);
  notes.push(`proxied WebSockets: ${[...wsUrls].join(", ")}`);

  const video = page.video();
  await context.close();
  await browser.close();
  if (video) renameSync(await video.path(), join(OUT, "webkit", "run.webm"));

  const out = { kind: "webkit-proxy" as const, url: URL, startedAt, userAgent, droppedMutations, droppedMarkRead, blockedRequests, results, notes };
  writeFileSync(join(OUT, "webkit-proxy.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${join(OUT, "webkit-proxy.json")} (dropped ${droppedMutations} mutations, blocked ${blockedRequests} requests)`);
}

if (import.meta.main) await main();
