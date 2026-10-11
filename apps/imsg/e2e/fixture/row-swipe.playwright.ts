import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

async function swipe(page: Page, rowName: string, dx: number) {
  const row = page.getByTestId("conversation-row").filter({ hasText: rowName });
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  const touch = (type: string, x: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", x0);
  for (let step = 1; step <= 16; step++) {
    await touch("touchMove", x0 + (dx * step) / 16);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", x0 + dx);
}

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("a phone row swiped right marks the conversation unread, with gesture-handler outside the entry chunk", async ({ desk }) => {
  const page = desk.page;
  const scripts: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith(".js")) scripts.push(request.url()); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.getByRole("tab", { name: "All", exact: true }).click();

  const entry = scripts.find((url) => /\/entry-[0-9a-f]+\.js$/.test(url));
  const entrySource = await (await page.request.get(entry!)).text();
  expect(entrySource.includes("GestureDetector got more than one view as a child"), "gesture-handler is in the entry chunk").toBe(false);

  await expect(page.getByTestId("conversation-row").filter({ hasText: /^Alex Rivera, unread,/ })).toHaveCount(0);
  await expect.poll(() => scripts.some((url) => /\/row-pan-[0-9a-f]+\.js$/.test(url))).toBe(true);
  await swipe(page, "Alex Rivera", 200);
  await expect(page.locator('[data-testid="conversation-row"][aria-label^="Alex Rivera, unread,"]')).toHaveCount(1);
});
