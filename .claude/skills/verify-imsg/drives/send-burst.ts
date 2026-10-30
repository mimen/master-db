import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_NOW } from "./world";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const sends = ["burst one", "burst two", "burst three"];
const inbound = "inbound mid-burst";
const probes = [...sends, inbound];

interface Sample { at: number; thread: string[]; preview: string }

test("send-burst: a burst keeps send order in the thread and the newest send in the preview while it resolves", async ({ desk }) => {
  const page = desk.page;
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  expect((await desk.request.post("/__fixture/send-timing", { data: { delayMs: 1500, echo: false } })).ok()).toBe(true);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" });
  await row.click();
  const thread = page.getByTestId("thread-view");
  await expect(thread).toBeVisible();

  await page.evaluate((texts) => {
    const samples: Sample[] = [];
    (window as unknown as { __burst: Sample[] }).__burst = samples;
    const start = performance.now();
    let last = "";
    setInterval(() => {
      const view = document.querySelector('[data-testid="thread-view"]');
      const leaves = view ? [...view.querySelectorAll("div")].filter((el) =>
        texts.includes(el.textContent ?? "") && ![...el.children].some((child) => child.textContent === el.textContent)) : [];
      const order = leaves.map((el) => ({ text: el.textContent ?? "", top: el.getBoundingClientRect().top }))
        .sort((a, b) => a.top - b.top).map((entry) => entry.text);
      const rowEl = [...document.querySelectorAll('[data-testid="conversation-row"]')].find((el) => el.textContent?.includes("Alex Rivera"));
      const preview = rowEl?.textContent ?? "";
      const signature = JSON.stringify([order, preview]);
      if (signature !== last) samples.push({ at: Math.round(performance.now() - start), thread: order, preview });
      last = signature;
    }, 30);
  }, probes);

  const frames = join(evidence, "frames");
  mkdirSync(frames, { recursive: true });
  let frame = 0;
  const shoot = async (label: string) => {
    await page.screenshot({ path: join(frames, `${String(frame++).padStart(2, "0")}-${label}.png`) });
  };
  await shoot("before");

  const composer = page.getByPlaceholder("iMessage");
  for (const text of sends) {
    const enqueued = page.waitForRequest((request) => {
      if (!request.url().endsWith("/__fixture/convex")) return false;
      const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string; text?: string } } };
      return body.name === "comma/outbox:enqueue" && body.args.payload?.text === text;
    });
    await composer.fill(text);
    await composer.press("Enter");
    await enqueued;
  }
  await shoot("burst-queued");
  const stored = async () => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId: desk.chats.needs, paginationOpts: { numItems: 10, cursor: null } } },
    });
    return ((await response.json()) as { page: { guid: string; text: string }[] }).page;
  };
  const timeline: { at: number; landed: string[]; thread: string[]; preview: string }[] = [];
  const start = Date.now();
  await page.waitForTimeout(700);
  await desk.receive(desk.chats.needs, inbound);
  while (Date.now() - start < 6_500) {
    const landed = (await stored()).filter((r) => sends.includes(r.text) && r.guid.startsWith("out-")).map((r) => r.text).reverse();
    const shown = await page.evaluate(() => (window as unknown as { __burst: Sample[] }).__burst.at(-1)!);
    timeline.push({ at: Date.now() - start, landed, thread: shown.thread, preview: sends.find((text) => shown.preview.includes(text)) ?? "" });
    await shoot(`landed-${landed.length}`);
    await page.waitForTimeout(300);
  }
  writeFileSync(join(evidence, "timeline.json"), JSON.stringify(timeline, null, 2));
  expect(new Set(timeline.map((tick) => tick.landed.length)), "the sends land one at a time").toEqual(new Set([0, 1, 2, 3]));
  await expect.poll(async () => (await stored()).filter((r) => sends.includes(r.text) && r.guid.startsWith("out-")).length).toBe(3);
  await page.waitForTimeout(1_200);
  await shoot("settled");

  const samples = await page.evaluate(() => (window as unknown as { __burst: Sample[] }).__burst);
  writeFileSync(join(evidence, "samples.json"), JSON.stringify(samples, null, 2));
  writeFileSync(join(evidence, "aria.txt"), await thread.ariaSnapshot());

  const rows = await stored();
  writeFileSync(join(evidence, "stored.json"), JSON.stringify(rows.map(({ guid, text }) => ({ guid, text })), null, 2));

  const expected = (shown: string[]) => {
    const arrived = shown.includes(inbound) ? [inbound] : [];
    return [...arrived, ...sends.filter((text) => shown.includes(text))];
  };
  const misordered = samples.filter((sample) => JSON.stringify(sample.thread) !== JSON.stringify(expected(sample.thread)));
  // The optimistic sidebar update moves the preview to each send as it is typed; it must never move back.
  const newest = samples.findIndex((sample) => sample.preview.includes(sends[2]!));
  const shownSend = samples.map((sample) => sends.findIndex((text) => sample.preview.includes(text)));
  const earlierSend = samples.filter((_, i) => shownSend[i]! < Math.max(-1, ...shownSend.slice(0, i)));
  const lostNewest = samples.slice(newest).filter((sample) => !sample.preview.includes(sends[2]!));
  expect.soft(misordered, "every frame shows the inbound above the sends, and the sends in send order").toEqual([]);
  expect(newest, "the preview reaches the newest send").toBeGreaterThan(-1);
  expect.soft(earlierSend, "the preview never falls back to an earlier send of the burst").toEqual([]);
  expect.soft(lostNewest, "the preview keeps the newest send through the burst").toEqual([]);
  expect(samples.at(-1)?.thread).toEqual([inbound, ...sends]);
  expect([...rows].reverse().map((r) => r.text).slice(-4)).toEqual([inbound, ...sends]);
});
