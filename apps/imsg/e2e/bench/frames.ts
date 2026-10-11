/**
 * Smoothness benchmark (metric 3b): frame times while the user scrolls a long thread, while
 * messages stream into the open thread, and while typing in the composer.
 *
 *   bun e2e/bench/frames.ts --target fixture --runs 9 [--cpu 4] [--profile <flow>]
 *
 * Frames come from requestAnimationFrame deltas; long animation frames from PerformanceObserver
 * ("long-animation-frame", falling back to "longtask"). Input-to-paint is keydown to the task after
 * the next frame's rAF (a MessageChannel post), which runs once that frame has painted.
 * CDP HeadlessExperimental.beginFrame would make frames deterministic, but Playwright's headless
 * shell hangs at launch with --enable-begin-frame-control, so runs repeat and the spread is reported.
 * --cpu throttles the renderer through CDP so a fast laptop shows the cost a phone would feel.
 * --profile <scroll|stream|typing> records a CPU profile of that flow in one extra run, writes it to
 * /tmp/comma-frames-<flow>.cpuprofile and prints the top self-time functions; it reports no numbers.
 */
import { writeFileSync } from "node:fs";
import { chromium, type CDPSession, type Page } from "@playwright/test";
import { cachedChromium } from "../chromium";
import { CHAT_GUIDS } from "../fixture/world";
import { renderCounter, type Renders } from "./renders";

const args = new Map<string, string>();
for (let i = 2; i < Bun.argv.length; i += 2) args.set(Bun.argv[i].replace(/^--/, ""), Bun.argv[i + 1]);
const runs = Number(args.get("runs") ?? 9);
const cpu = Number(args.get("cpu") ?? 4);
const profileFlow = args.get("profile") as Flow | undefined;
const base = `http://127.0.0.1:${process.env.IMSG_FIXTURE_PORT ?? 8399}`;
const CHAT = CHAT_GUIDS.needs;
const SEEDED = 200;
const STREAMED = 20;
const TYPED = "See you at the venue around eight thirty";

type Flow = "scroll" | "stream" | "typing";
interface Sample { frames: number[]; long: number[]; inputs: number[]; renders: Renders }

/** Page init script: frame deltas, long frames and keydown-to-paint delays, recorded only while `__recording`. */
const recorder = (): void => {
  const w = window as unknown as { __recording: boolean; __sample: { frames: number[]; long: number[]; inputs: number[] } };
  w.__recording = false;
  w.__sample = { frames: [], long: [], inputs: [] };
  let last = 0;
  const tick = (now: number) => {
    if (w.__recording && last) w.__sample.frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const type = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame") ? "long-animation-frame" : "longtask";
  new PerformanceObserver((list) => {
    if (w.__recording) for (const entry of list.getEntries()) w.__sample.long.push(entry.duration);
  }).observe({ type });
  addEventListener("keydown", (event) => {
    if (!w.__recording) return;
    const start = event.timeStamp;
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => w.__sample.inputs.push(performance.now() - start);
      channel.port2.postMessage(null);
    });
  }, { capture: true });
};

async function record(page: Page, on: boolean): Promise<Sample> {
  return page.evaluate((next) => {
    const w = window as unknown as { __recording: boolean; __sample: Omit<Sample, "renders">; __renders: Renders };
    const sample = { ...w.__sample, renders: { ...w.__renders } };
    w.__recording = next;
    if (next) {
      w.__sample = { frames: [], long: [], inputs: [] };
      for (const key of Object.keys(w.__renders) as Array<keyof Renders>) w.__renders[key] = 0;
    }
    return sample;
  }, on);
}

async function receive(page: Page, text: string): Promise<void> {
  await page.request.post(`${base}/__fixture/receive`, { data: { chatGuid: CHAT, text, handle: CHAT.split(";").at(-1) } });
}

async function openThread(page: Page): Promise<void> {
  await page.goto(base + "/");
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();
  await page.getByTestId("thread-view").getByText(`Seeded message ${SEEDED}`).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
}

const flows: Record<Flow, (page: Page) => Promise<void>> = {
  async scroll(page) {
    const list = await page.getByTestId("thread-message-list").boundingBox();
    if (!list) throw new Error("thread list not on screen");
    await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
    for (let step = 0; step < 60; step++) {
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(16);
    }
    await page.getByTestId("thread-view").getByText("Seeded message 1", { exact: true }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
  },
  async stream(page) {
    for (let i = 1; i <= STREAMED; i++) {
      await receive(page, `Streamed message ${i}`);
      await page.waitForTimeout(100);
    }
    await page.getByTestId("thread-view").getByText(`Streamed message ${STREAMED}`).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
  },
  async typing(page) {
    await page.getByPlaceholder("iMessage").click();
    await page.keyboard.type(TYPED, { delay: 60 });
    await page.waitForTimeout(500);
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
  },
};

const pct = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const round = (n: number): number => Math.round(n * 10) / 10;

function summarize(sample: Sample) {
  return {
    frames: sample.frames.length,
    p95: round(pct(sample.frames, 95)),
    over16: sample.frames.filter((f) => f > 16.7 + 1).length,
    over33: sample.frames.filter((f) => f > 33.4).length,
    longFrames: sample.long.length,
    longMs: Math.round(sample.long.reduce((a, b) => a + b, 0)),
    inputP95: sample.inputs.length ? round(pct(sample.inputs, 95)) : null,
    keys: sample.inputs.length,
    ...sample.renders,
  };
}

async function topSelfTime(cdp: CDPSession, flow: Flow): Promise<void> {
  const { profile } = (await cdp.send("Profiler.stop")) as { profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number }>; samples: number[]; timeDeltas: number[] } };
  writeFileSync(`/tmp/comma-frames-${flow}.cpuprofile`, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const frame = byId.get(id)?.callFrame;
    if (!frame) return;
    const key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").at(-1)}:${frame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${key}`);
}

const browser = await chromium.launch({ executablePath: cachedChromium(), headless: true });
const results: Record<Flow, ReturnType<typeof summarize>[]> = { scroll: [], stream: [], typing: [] };
const total = profileFlow ? 1 : runs;
for (let run = 0; run < total; run++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.request.post(`${base}/__fixture/reset`);
  for (let i = 1; i <= SEEDED; i++) await context.request.post(`${base}/__fixture/receive`, { data: { chatGuid: CHAT, text: `Seeded message ${i}`, handle: CHAT.split(";").at(-1) } });
  const page = await context.newPage();
  await page.addInitScript(recorder);
  await page.addInitScript(renderCounter);
  const cdp = await context.newCDPSession(page);
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await openThread(page);
  for (const flow of ["scroll", "stream", "typing"] as const) {
    if (flow === "stream" || flow === "typing") await openThread(page);
    const profiling = profileFlow === flow;
    if (profiling) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    await record(page, true);
    await flows[flow](page);
    const sample = await record(page, false);
    if (profiling) await topSelfTime(cdp, flow);
    results[flow].push(summarize(sample));
  }
  if (!profileFlow) console.log(JSON.stringify({ run, scroll: results.scroll.at(-1), stream: results.stream.at(-1), typing: results.typing.at(-1) }));
  await context.close();
}
await browser.close();

if (!profileFlow) {
  const median = (values: number[]): number => pct(values, 50);
  const spread = (values: number[]) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) });
  const report = Object.fromEntries((Object.keys(results) as Flow[]).map((flow) => {
    const rows = results[flow];
    return [flow, {
      p95: spread(rows.map((r) => r.p95)),
      over16: spread(rows.map((r) => r.over16)),
      over33: spread(rows.map((r) => r.over33)),
      longFrames: spread(rows.map((r) => r.longFrames)),
      longMs: spread(rows.map((r) => r.longMs)),
      commits: spread(rows.map((r) => r.commits)),
      threadView: spread(rows.map((r) => r.threadView)),
      cells: spread(rows.map((r) => r.cells)),
      rows: spread(rows.map((r) => r.rows)),
      bubbles: spread(rows.map((r) => r.bubbles)),
      composer: spread(rows.map((r) => r.composer)),
      ...(flow === "typing" ? { inputP95: spread(rows.map((r) => r.inputP95 ?? 0)), keys: spread(rows.map((r) => r.keys)) } : {}),
    }];
  }));
  console.log(JSON.stringify({ summary: true, runs, cpu, ...report }));
}
