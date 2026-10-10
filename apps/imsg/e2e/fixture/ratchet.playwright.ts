import type { Page } from "@playwright/test";
import { census, REGIONS, type Shift } from "../bench/census";
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

test("the queue header holds still while the conversation list loads late", async ({ desk }) => {
  const page = desk.page;
  await page.addInitScript(census, REGIONS);
  let held = false;
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    if (body.name === "comma/queries:listConversations" && !held) {
      held = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  expect(shifts.filter((shift) => shift.region === "triage-queue-header")).toEqual([]);
});

/** Starts an in-page clock: the first `type` event's timestamp, then the first frame in which `shown` holds. */
async function timeToFrame(page: Page, type: "pointerdown" | "keydown", shown: string): Promise<void> {
  await page.evaluate(([eventType, source]) => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    const check = new Function(`return (${source})()`) as () => boolean;
    addEventListener(eventType, (event) => { ratchet.__inputAt ??= event.timeStamp; }, { capture: true, once: true });
    const poll = (now: number) => {
      if (ratchet.__inputAt !== undefined && check()) ratchet.__shownAt = now;
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }, [type, shown] as const);
}

async function elapsedToFrame(page: Page): Promise<number> {
  const elapsed = await page.waitForFunction(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    return ratchet.__shownAt !== undefined && ratchet.__inputAt !== undefined ? ratchet.__shownAt - ratchet.__inputAt : false;
  }, undefined, { timeout: 5_000 });
  return Number(await elapsed.jsonValue());
}

async function rowMenuItem(page: Page, name: string, item: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  const row = page.getByTestId("conversation-row").filter({ hasText: name });
  await row.hover();
  await row.getByRole("button", { name: /More actions for/ }).click();
  return page.getByRole("dialog").getByText(item, { exact: true });
}

test("ratchet: settling the open conversation moves the Needs reply count within 50 ms of ⌘E", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByPlaceholder("iMessage").blur();
  const label = await page.locator('[aria-label^="Needs reply, "]').getAttribute("aria-label");
  const before = Number(label?.slice("Needs reply, ".length));
  await timeToFrame(page, "keydown", `() => document.querySelector('[aria-label="Needs reply, ${before - 1}"]') !== null`);
  await page.keyboard.press("Meta+e");
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
});

test("ratchet: a conversation marked unread reads as unread within 50 ms of the click", async ({ desk }) => {
  const page = desk.page;
  const markUnread = await rowMenuItem(page, "Alex Rivera", "Mark as unread");
  await timeToFrame(page, "pointerdown", `() => [...document.querySelectorAll('[data-testid="conversation-row"]')]
    .some((row) => /^Alex Rivera, unread,/.test(row.getAttribute("aria-label") ?? ""))`);
  await markUnread.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
});

test("a mark read shows at once and rolls back with a toast when the bridge fails it", async ({ desk }) => {
  const fault = await desk.request.post("/__fixture/fault", { data: { method: "markRead" } });
  expect(fault.ok()).toBe(true);
  const page = desk.page;
  const markRead = await rowMenuItem(page, "Launch Crew", "Mark as read");
  const row = page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" });
  await expect(row).toHaveAttribute("aria-label", /^Launch Crew, unread,/);
  const cleared = page.waitForFunction(() => [...document.querySelectorAll('[data-testid="conversation-row"]')]
    .some((element) => /^Launch Crew, (?!unread)/.test(element.getAttribute("aria-label") ?? "")), undefined, { polling: "raf", timeout: 5_000 });
  await markRead.click();
  await cleared;
  await expect(row).toHaveAttribute("aria-label", /^Launch Crew, unread,/);
  await expect(page.getByText("Couldn't mark as read. Try again.")).toBeVisible();
});
