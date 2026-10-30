import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const SLOW_MS = Number(process.env.SETTLE_SLOW_MS ?? 1500);
const WATCH_MS = SLOW_MS + 2500;
const LENS = process.env.SETTLE_LENS === "today" ? /^Today/ : /^Needs you, \d+/;

/** `h`: visible height, see startSampler. `x`: how far the row sits left of where it rests, in px. */
interface Frame { t: number; h: number; x: number }

/**
 * Every animation frame, how much of the conversation row labelled `name` the user can see, as a height: its visible
 * area, clipped by the viewport and every overflow-hiding ancestor and weighted by opacity down the tree, over its
 * width. A collapsing row keeps its own box and a swiped one keeps its height, so raw height says nothing. 0 means no
 * visible row.
 */
async function startSampler(page: Page, name: string): Promise<void> {
  await page.evaluate((target) => {
    const frames: { t: number; h: number; x: number }[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    const t0 = performance.now();
    let rest: number | null = null;
    const visible = (row: HTMLElement): number => {
      const box = row.getBoundingClientRect();
      let { top, bottom, left, right } = box;
      left = Math.max(left, 0);
      right = Math.min(right, window.innerWidth);
      let opacity = 1;
      for (let node: HTMLElement | null = row; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        opacity *= Number(style.opacity);
        if (node !== row && style.overflow !== "visible") {
          const clip = node.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
      }
      return box.width ? (Math.max(0, bottom - top) * Math.max(0, right - left) * opacity) / box.width : 0;
    };
    const tick = () => {
      let h = 0;
      let x = 0;
      for (const row of document.querySelectorAll<HTMLElement>('[data-testid="conversation-row"]')) {
        if (!row.getAttribute("aria-label")?.startsWith(target)) continue;
        const left = row.getBoundingClientRect().left;
        rest ??= left;
        h = Math.max(h, visible(row));
        x = Math.round(rest - left);
      }
      frames.push({ t: Math.round(performance.now() - t0), h: Math.round(h), x });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, name);
}

/**
 * Frames where a settled row shows again: back at full height after it dropped below half of it, or, still visible,
 * sliding 40px or more back toward its place after a swipe moved it out.
 */
function reappearances(frames: Frame[], fullHeight: number): Frame[] {
  let shrunk = false;
  let swipedTo = 0;
  const back: Frame[] = [];
  for (const frame of frames) {
    if (frame.h < fullHeight / 2) shrunk = true;
    else if (shrunk && frame.h >= fullHeight * 0.9) back.push(frame);
    swipedTo = Math.max(swipedTo, frame.x);
    if (swipedTo >= 40 && swipedTo - frame.x >= 40 && frame.h >= fullHeight * 0.1) back.push(frame);
  }
  return back;
}

function watchConvex(page: Page, t0: number): string[] {
  const log: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name?: string; args?: { payload?: { kind?: string } } } | null;
    if (body?.name === "comma/queries:listConversations" || body?.name === "comma/outbox:getCommand") return;
    log.push(`${Date.now() - t0}ms ${body?.name}${body?.args?.payload?.kind ? ` ${body.args.payload.kind}` : ""}`);
  });
  return log;
}

async function slowSettle(page: Page): Promise<void> {
  for (const name of ["comma/outbox:enqueue", "comma/triage:settle", "comma/agent:settleConversationAgents"]) {
    const response = await page.request.post("/__fixture/latency", { data: { name, delayMs: SLOW_MS } });
    expect(response.ok()).toBe(true);
  }
}

async function capture(page: Page, dir: string, settle: () => Promise<void>, name: string, fullHeight: number) {
  mkdirSync(dir, { recursive: true });
  await startSampler(page, name);
  const t0 = Date.now();
  const convex = watchConvex(page, t0);
  await settle();
  const shots: string[] = [];
  for (let i = 0; Date.now() - t0 < WATCH_MS; i++) {
    const file = `${String(i).padStart(3, "0")}-${Date.now() - t0}ms.png`;
    await page.screenshot({ path: join(dir, file) });
    shots.push(file);
  }
  const frames = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
  const back = reappearances(frames, fullHeight);
  writeFileSync(join(dir, "frames.json"), JSON.stringify({ name, fullHeight, slowMs: SLOW_MS, convex, frames, back }, null, 1));
  return { frames, back, convex };
}

test("settle-flicker: a sidebar settle never shows the row again", async ({ desk }) => {
  const page = desk.page;
  await slowSettle(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: LENS }).click();
  const row = page.getByTestId("conversation-row").nth(1);
  await expect(row).toBeVisible();
  const name = (await row.getAttribute("aria-label"))!.split(",")[0]!;
  const fullHeight = (await row.boundingBox())!.height;
  await row.hover();
  const { back, frames } = await capture(page, join(evidence, "desk"), async () => {
    await row.getByRole("button", { name: `Settle ${name}` }).click();
  }, name, fullHeight);
  expect(frames.some((frame) => frame.h === 0), "the row left").toBe(true);
  expect(back, `row reappeared at ${back.map((f) => `${f.t}ms`).join(", ")}`).toEqual([]);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("conversation-row").filter({ hasText: name }), "Undo brings it back").toHaveCount(1);
  await page.screenshot({ path: join(evidence, "desk", "after-undo.png") });
});

test.describe("phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("settle-flicker: a phone list swipe settle never shows the row again", async ({ desk }) => {
    const page = desk.page;
    await slowSettle(page);
    await page.goto("/");
    await page.getByRole("tab", { name: LENS }).click();
    const row = page.getByTestId("conversation-row").nth(1);
    await expect(row).toBeVisible();
    const name = (await row.getAttribute("aria-label"))!.split(",")[0]!;
    const box = (await row.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2;
    const x0 = box.x + box.width / 2;
    const touch = (type: string, x: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const { back, frames } = await capture(page, join(evidence, "phone"), async () => {
      await touch("touchStart", x0);
      for (let step = 1; step <= 16; step++) {
        await touch("touchMove", x0 - (200 * step) / 16);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd", x0 - 200);
    }, name, box.height);
    expect(frames.some((frame) => frame.h === 0), "the row left").toBe(true);
    expect(back, `row reappeared at ${back.map((f) => `${f.t}ms`).join(", ")}`).toEqual([]);
  });
});
