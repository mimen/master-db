import type { Page } from "@playwright/test";
import { FIXTURE_NOW } from "./world";
import { expect, test } from "../fixtures/desk";

const SMS_GREEN = "rgb(52, 199, 89)";
const IMESSAGE_BLUE = "rgb(0, 122, 255)";

/** Records the bubble's painted background on every animation frame it is on screen. */
async function traceBubbleColor(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const frames: string[] = [];
    (window as unknown as { __bubbleColors: string[] }).__bubbleColors = frames;
    const sample = (): void => {
      const match = [...document.querySelectorAll("div")].find(
        (element) => element.textContent === needle && ![...element.children].some((child) => child.textContent === needle),
      );
      for (let node: Element | null = match ?? null; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)") { frames.push(color); break; }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, text);
}

const readColors = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __bubbleColors: string[] }).__bubbleColors);

for (const chat of [
  { kind: "SMS", name: "Sam Chen", placeholder: "Text Message", color: SMS_GREEN },
  { kind: "RCS", name: "Dana Whitfield", placeholder: "Text Message", color: SMS_GREEN },
  { kind: "iMessage", name: "Alex Rivera", placeholder: "iMessage", color: IMESSAGE_BLUE },
] as const) {
  test(`a pending ${chat.kind} send is drawn in its service color on every frame`, async ({ desk }) => {
    const timing = await desk.request.post("/__fixture/send-timing", { data: { delayMs: 3000, echo: false } });
    expect(timing.ok()).toBe(true);
    const page = desk.page;
    await page.addInitScript((fixtureNow) => {
      const realNow = Date.now.bind(Date);
      const offset = fixtureNow - realNow();
      Date.now = () => realNow() + offset;
    }, FIXTURE_NOW);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.goto("/?send", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "All", exact: true }).click();
    await page.getByLabel("Search conversations and messages").fill(chat.name);
    await page.getByTestId("conversation-row").filter({ hasText: chat.name }).first().click();
    const composer = page.getByPlaceholder(chat.placeholder);
    await expect(composer).toBeVisible();

    const text = `Pending ${chat.kind} color probe`;
    await traceBubbleColor(page, text);
    await composer.fill(text);
    await composer.press("Enter");
    await expect(page.getByText("Sending…")).toBeVisible({ timeout: 2500 });
    await page.screenshot({ path: `/tmp/comma-pending-${chat.kind}.png` });
    await expect(page.getByText("Sent", { exact: true })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(600);

    const frames = await readColors(page);
    const counts = Object.fromEntries([...new Set(frames)].map((color) => [color, frames.filter((c) => c === color).length]));
    const runs = frames.reduce<string[]>((out, color, i) => (color === frames[i - 1] ? out : [...out, color]), []);
    console.log(`${chat.kind} bubble frames: ${JSON.stringify(counts)} in order ${runs.join(" -> ")}`);
    expect(frames.length).toBeGreaterThan(60);
    expect(counts).toEqual({ [chat.color]: frames.length });
  });
}
