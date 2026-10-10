import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

/**
 * Hill-climb ratchets (docs/hillclimb/README.md). Each test pins a kept performance win,
 * so a change that gives it back fails CI.
 */

test("Contacts and its people list wait for the first visit, then stay mounted", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await expect(page.getByTestId("contacts-desk-header")).toHaveCount(0);

  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByTestId("contacts-desk-header")).toBeVisible();
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect(page.getByTestId("contacts-desk-header")).toHaveCount(1);
});


const INBOUND = "Can you send the final arrival time?";

/** The Like badge under a bubble, not the Like button in the open tray. */
function likeBadgeShown(): boolean {
  return [...document.querySelectorAll('[data-testid="thread-view"] [aria-label="Like"]')]
    .some((element) => !element.closest('[role="toolbar"]'));
}

async function openTray(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByTestId("thread-view").getByRole("button", { name: `Alex Rivera: ${INBOUND}` }).click({ button: "right" });
  return page.getByRole("toolbar", { name: "Tapbacks" }).getByRole("button", { name: "Like", exact: true });
}

test("a tapback shows at once and rolls back with a toast when the bridge fails it", async ({ desk }) => {
  const fault = await desk.request.post("/__fixture/fault", { data: { method: "react" } });
  expect(fault.ok()).toBe(true);
  const page = desk.page;
  const like = await openTray(page);
  const shown = page.waitForFunction(likeBadgeShown, undefined, { polling: "raf", timeout: 5_000 });
  await like.click();
  await shown;
  const badge = page.getByTestId("thread-view").getByRole("button", { name: "Like", exact: true });
  await expect(badge).toHaveCount(0);
  await expect(page.getByText("Couldn't send the reaction. Try again.")).toBeVisible();
});

test("ratchet: a tapback badge is on screen within 50 ms of the click", async ({ desk }) => {
  const page = desk.page;
  const like = await openTray(page);
  await page.evaluate(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    addEventListener("pointerdown", (event) => { ratchet.__inputAt ??= event.timeStamp; }, { capture: true, once: true });
    const poll = (now: number) => {
      const shown = [...document.querySelectorAll('[data-testid="thread-view"] [aria-label="Like"]')]
        .some((element) => !element.closest('[role="toolbar"]'));
      if (shown && ratchet.__inputAt !== undefined) ratchet.__shownAt = now;
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await like.click();
  const elapsed = await page.waitForFunction(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    return ratchet.__shownAt !== undefined && ratchet.__inputAt !== undefined ? ratchet.__shownAt - ratchet.__inputAt : false;
  }, undefined, { timeout: 5_000 });
  expect(Number(await elapsed.jsonValue())).toBeLessThanOrEqual(50);
});
