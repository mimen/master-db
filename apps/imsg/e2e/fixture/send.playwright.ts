import type { Page } from "@playwright/test";
import { FIXTURE_NOW } from "./world";
import { expect, test } from "../fixtures/desk";

interface BubbleTrace {
  /** Distinct DOM nodes that rendered the text: 1 means the row never remounted. */
  nodes: number;
  /** Frames after the entrance finished where the bubble vanished or got fainter than the frame before. */
  dips: number;
}

async function traceBubble(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const ids = new WeakMap<Element, number>();
    const trace = { nodes: 0, dips: 0, last: -1, entered: false, opacity: () => 0 };
    (window as unknown as { __bubbleTrace: typeof trace }).__bubbleTrace = trace;
    const opacityOf = (element: Element): number => {
      let value = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        value *= Number(getComputedStyle(node).opacity);
      }
      return value;
    };
    const find = (): Element | undefined =>
      [...document.querySelectorAll("div")].find(
        (element) =>
          element.textContent === needle &&
          ![...element.children].some((child) => child.textContent === needle),
      );
    trace.opacity = () => {
      const match = find();
      return match ? opacityOf(match) : 0;
    };
    const sample = (): void => {
      const match = find();
      const opacity = match ? opacityOf(match) : 0;
      if (match && !ids.has(match)) ids.set(match, ++trace.nodes);
      if (trace.entered && opacity < trace.last - 0.01) trace.dips++;
      if (trace.nodes > 0 && trace.last >= 0 && trace.last < 1 && opacity >= 1) trace.entered = true;
      if (trace.nodes > 0) trace.last = opacity;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, text);
}

async function readTrace(page: Page): Promise<BubbleTrace> {
  return page.evaluate(() => {
    const { nodes, dips } = (window as unknown as { __bubbleTrace: BubbleTrace }).__bubbleTrace;
    return { nodes, dips };
  });
}

async function opacityNow(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.round((window as unknown as { __bubbleTrace: { opacity: () => number } }).__bubbleTrace.opacity() * 100) / 100,
  );
}

async function openThread(desk: Parameters<Parameters<typeof test>[1]>[0]["desk"]): Promise<Page> {
  const page = desk.page;
  // The server's clock is pinned to FIXTURE_NOW; shift the page's to match so
  // fresh messages count as fresh, without faking the timers the trace runs on.
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/?send", { waitUntil: "domcontentloaded" });
  // All, not Needs reply: a send in Needs reply auto-advances to the next conversation,
  // which would replace the thread these probes watch.
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByPlaceholder("iMessage")).toBeVisible();
  return page;
}

async function sendText(page: Page, text: string): Promise<void> {
  const command = page.waitForRequest((request) => {
    if (!request.url().endsWith("/__fixture/convex") || request.method() !== "POST") return false;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string; text?: string } } };
    return body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "send" && body.args.payload.text === text;
  });
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill(text);
  await composer.press("Enter");
  await command;
}

for (const order of [
  { name: "echo before response", timing: { delayMs: 600, echo: true } },
  { name: "response before echo", timing: null },
] as const) {
  test(`sent bubble stays mounted and opaque: ${order.name}`, async ({ desk }) => {
    const timing = await desk.request.post("/__fixture/send-timing", { data: order.timing ?? {} });
    expect(timing.ok()).toBe(true);
    const page = await openThread(desk);
    const text = `Flicker probe ${order.name}`;
    await traceBubble(page, text);
    await sendText(page, text);
    await expect(page.getByText("Sent", { exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    expect(await readTrace(page)).toEqual({ nodes: 1, dips: 0 });
    await expect(page.getByTestId("thread-view").getByText(text, { exact: true })).toHaveCount(1);
  });
}

test("a slow send renders at full color and only says Sending… once it is actually slow", async ({ desk }) => {
  const timing = await desk.request.post("/__fixture/send-timing", { data: { delayMs: 3000, echo: false } });
  expect(timing.ok()).toBe(true);
  const page = await openThread(desk);
  const text = "Slow send probe";
  await traceBubble(page, text);
  await sendText(page, text);
  await page.waitForTimeout(600);
  expect(await opacityNow(page)).toBe(1);
  await expect(page.getByText("Sending…")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-send-pending-early.png" });
  await expect(page.getByText("Sending…")).toBeVisible({ timeout: 2000 });
  await page.screenshot({ path: "/tmp/comma-send-pending-slow.png" });
  await expect(page.getByText("Sent", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("Sending…")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-send-settled.png" });
  expect(await readTrace(page)).toEqual({ nodes: 1, dips: 0 });
});
