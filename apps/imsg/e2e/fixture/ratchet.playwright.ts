import type { Page, Route } from "@playwright/test";
import { census, REGIONS, type Shift } from "../bench/census";
import { renderCounter, type Renders } from "../bench/renders";
import { expect, test } from "../fixtures/desk";

/**
 * Hill-climb ratchets (docs/hillclimb/README.md). Each test pins a kept performance win,
 * so a change that gives it back fails CI.
 */

test.use({
  launchOptions: async ({ launchOptions }, provide) => {
    await provide({ ...launchOptions, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  },
});

/** Continues a held request. The page can give one up while it is held, and then there is nothing to continue. */
async function continueHeld(route: Route): Promise<void> {
  await route.continue().catch((error: unknown) => {
    if (!String(error).includes("Route is already handled")) throw error;
  });
}

test("the desk tears down while a route still holds a request and another handler finishes", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/__fixture/teardown-probe");
  await page.route("**/__fixture/teardown-probe?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, route.request().url().endsWith("held") ? 300 : 50));
    await continueHeld(route);
  });
  await page.evaluate(() => { void fetch("/__fixture/teardown-probe?held"); void fetch("/__fixture/teardown-probe?quick"); });
  await page.waitForTimeout(20);
});

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
  const like = page.getByRole("toolbar", { name: "Tapbacks" }).getByRole("button", { name: "Like", exact: true });
  // The tray first opens slowly on a cold runner; that wait must not count against the badge's.
  await expect(like).toBeVisible();
  return like;
}

/** Opening a thread used to drop a right-click: the suggestion row arrived 30 px tall and moved the bubble off the pointer. */
test("an open thread holds still while its suggestions load, so a right-click at once opens the tray", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" });
  await expect(row).toBeVisible();
  await page.evaluate((label) => {
    const tops: number[] = ((window as unknown as { __tops: number[] }).__tops = []);
    const sample = () => {
      const bubble = document.querySelector(`[data-testid="thread-view"] [aria-label="${label}"]`);
      const top = bubble ? Math.round(bubble.getBoundingClientRect().top) : null;
      if (top !== null && tops.at(-1) !== top) tops.push(top);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, `Alex Rivera: ${INBOUND}`);
  // A slow machine widens the gap between the bubble painting and the suggestions arriving.
  await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await row.click();
  await page.getByTestId("thread-view").getByRole("button", { name: `Alex Rivera: ${INBOUND}` }).click({ button: "right" });
  await expect(page.getByRole("toolbar", { name: "Tapbacks" })).toBeVisible();
  await expect(page.getByTestId("suggestion-alternates").getByRole("button").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __tops: number[] }).__tops), "the bubble's top, each time it moved").toHaveLength(1);
});

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
    await continueHeld(route);
  });
  await page.goto("/", { waitUntil: "commit" });
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  expect(shifts.filter((shift) => shift.region === "triage-queue-header")).toEqual([]);
});

test("the phone screen holds still while it loads", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addInitScript(census, REGIONS);
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.waitForTimeout(2000);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  expect(shifts).toEqual([]);
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
  const ms = Number(await elapsed.jsonValue());
  console.log(`${test.info().title}: ${ms.toFixed(1)} ms`);
  return ms;
}

async function rowMenuItem(page: Page, name: string, item: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  const row = page.getByTestId("conversation-row").filter({ hasText: name });
  await row.hover();
  await row.getByRole("button", { name: /More actions for/ }).click();
  return page.getByRole("dialog").getByText(item, { exact: true });
}

test("ratchet: settling the open conversation moves the Needs you count within 50 ms of ⌘E", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByPlaceholder("iMessage").blur();
  const label = await page.locator('[aria-label^="Needs you, "]').getAttribute("aria-label");
  const before = Number(label?.slice("Needs you, ".length));
  await timeToFrame(page, "keydown", `() => document.querySelector('[aria-label="Needs you, ${before - 1}"]') !== null`);
  await page.keyboard.press("Meta+e");
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
});

test("ratchet: a conversation marked unread reads as unread within 50 ms of the click", async ({ desk }) => {
  const page = desk.page;
  // The seed leaves Alex's question unread, so read it first for the menu to offer Mark as unread.
  await (await rowMenuItem(page, "Alex Rivera", "Mark as read")).click();
  await expect(page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" })).toHaveAttribute("aria-label", /^Alex Rivera, (?!unread)/);
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

/** An audio bubble's duration ("0:03"), which only a voice message in the thread list draws. */
const VOICE_BUBBLE = `() => [...document.querySelectorAll('[data-testid="thread-message-list"] *')]
  .some((element) => element.childElementCount === 0 && /^\\d+:\\d\\d$/.test(element.textContent ?? ""))`;

async function recordVoice(page: Page) {
  await page.context().grantPermissions(["microphone"]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByRole("button", { name: "Record voice message" }).click();
  await expect(page.getByText("0:01", { exact: true })).toBeVisible();
  return page.getByRole("button", { name: "Send voice message" });
}

test("ratchet: a sent voice message is in the thread within 50 ms of the click", async ({ desk }) => {
  const page = desk.page;
  // A real upload takes longer than a frame; on the bare fixture it can finish inside 50 ms.
  await page.route("**/__fixture/upload", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await continueHeld(route);
  });
  const send = await recordVoice(page);
  await timeToFrame(page, "pointerdown", VOICE_BUBBLE);
  await send.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
});

test("a voice message shows at once, then leaves with a toast and stays staged when the bridge fails it", async ({ desk }) => {
  const fault = await desk.request.post("/__fixture/fault", { data: { method: "sendAudio" } });
  expect(fault.ok()).toBe(true);
  const page = desk.page;
  const send = await recordVoice(page);
  const shown = page.waitForFunction(VOICE_BUBBLE, undefined, { polling: "raf", timeout: 5_000 });
  await send.click();
  await shown;
  await expect(page.getByText("Couldn't send the voice message. Check the Mac mini connection.")).toBeVisible();
  expect(await page.evaluate(`(${VOICE_BUBBLE})()`)).toBe(false);
  await expect(page.getByRole("button", { name: "Remove attachment" })).toBeVisible();
});

/** Opens the forward picker on Alex's question and returns Jordan's row in it. */
async function forwardToJordan(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByTestId("thread-view").getByRole("button", { name: `Alex Rivera: ${INBOUND}` }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Forward" }).click();
  await page.getByPlaceholder("Forward to…").fill("Jordan");
  return page.getByRole("button", { name: "Jordan Lee", exact: true });
}

const FORWARDED = `() => [...document.querySelectorAll('[data-testid="thread-view"] [role="button"]')]
  .some((element) => element.getAttribute("aria-label") === "You: ${INBOUND}")`;

/** A send held by /__fixture/send-timing must land before the next test resets the world, or it lands in that one. */
async function settleDelayedSend(page: Page) {
  await expect(page.getByTestId("thread-view").getByText(/^(Sent|Delivered|Read .*)$/)).toBeVisible();
}

/**
 * Forward also closes the picker and opens another thread, the heaviest frame of these ratchets. On GitHub's
 * macos-latest runner, 43c15e78 (before #61) measured 45 to 107 ms, median 67, over 9 runs (run 42419120618), where
 * a laptop measures 24 to 30 ms, so the runner alone breaks 50 ms. Since opening a thread stopped re-rendering the
 * shell (#80) the runner measures 28.5 ms (run 42428954629) and a laptop a median of 25 ms over 9 runs, from 41 ms
 * at f3857b7b. 100 ms keeps room for a slow runner and still fails a forward that waits for the 300 ms held send.
 */
const FORWARD_LIMIT_MS = process.env.CI ? 100 : 50;

test("ratchet: a forwarded message is in the destination thread within 50 ms of the click", async ({ desk }) => {
  // A real bridge takes longer than a frame; the bare fixture can answer inside 50 ms.
  expect((await desk.request.post("/__fixture/send-timing", { data: { delayMs: 300 } })).ok()).toBe(true);
  const page = desk.page;
  const jordan = await forwardToJordan(page);
  await timeToFrame(page, "pointerdown", FORWARDED);
  await jordan.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(FORWARD_LIMIT_MS);
  await settleDelayedSend(page);
});

test("a forward shows at once and turns Not delivered with a toast when the bridge fails it", async ({ desk }) => {
  const fault = await desk.request.post("/__fixture/fault", { data: { method: "sendText" } });
  expect(fault.ok()).toBe(true);
  const page = desk.page;
  const jordan = await forwardToJordan(page);
  const shown = page.waitForFunction(FORWARDED, undefined, { polling: "raf", timeout: 5_000 });
  await jordan.click();
  await shown;
  await expect(page.getByText("Forward failed")).toBeVisible();
  await expect(page.getByTestId("thread-view").getByText("Not delivered", { exact: true })).toBeVisible();
});

/** Opens new-message compose with Alex as the recipient and `text` typed; returns its Send button. */
async function composeToAlex(page: Page, text: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.keyboard.press("Meta+n");
  await page.getByPlaceholder("Name, number, or email").fill("Alex");
  await expect(page.getByText("(619) 555-0101").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Alex Rivera" })).toBeVisible();
  await page.getByRole("dialog").getByPlaceholder("Message").fill(text);
  return page.getByRole("button", { name: "Send", exact: true }).last();
}

const ownBubble = (text: string) => `() => [...document.querySelectorAll('[data-testid="thread-view"] [role="button"]')]
  .filter((element) => element.getAttribute("aria-label") === "You: ${text}").length`;

test("ratchet: a new message shows it is sending within 50 ms of Send", async ({ desk }) => {
  const page = desk.page;
  // send-timing does not reach createChat, so hold its enqueue the way a real bridge would.
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "createChat") await new Promise((resolve) => setTimeout(resolve, 300));
    await continueHeld(route);
  });
  const send = await composeToAlex(page, "palette probe");
  // The palette's Sending ring paints on the click; the thread with the bubble mounts a frame later.
  await timeToFrame(page, "pointerdown", `() => document.querySelector('[aria-label="Sending"]') !== null || (${ownBubble("palette probe")})() > 0`);
  await send.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
  await settleDelayedSend(page);
});

test("a new message shows at once and turns Not delivered with a toast when the bridge fails it", async ({ desk }) => {
  expect((await desk.request.post("/__fixture/fault", { data: { method: "createChat" } })).ok()).toBe(true);
  const page = desk.page;
  const send = await composeToAlex(page, "palette fault probe");
  const shown = page.waitForFunction(`(${ownBubble("palette fault probe")})() > 0`, undefined, { polling: "raf", timeout: 5_000 });
  await send.click();
  await shown;
  await expect(page.getByText(/^Couldn't start/)).toBeVisible();
  await expect(page.getByTestId("thread-view").getByText("Not delivered", { exact: true })).toBeVisible();
});

/** Avery's older send carries a stale error code in the seed, so its menu offers Send again. */
async function sendAgainMenuItem(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Avery Brooks" }).click();
  const own = page.getByTestId("thread-view").getByRole("button", { name: AVERY_SEND });
  await expect(own).toHaveCount(1);
  await own.click({ button: "right" });
  return page.getByRole("menuitem", { name: "Send again" });
}
const AVERY_SEND = "You: Following up on Avery's plan.";

test("ratchet: Send again puts the new copy in the thread within 50 ms of the click", async ({ desk }) => {
  expect((await desk.request.post("/__fixture/send-timing", { data: { delayMs: 300 } })).ok()).toBe(true);
  const page = desk.page;
  const again = await sendAgainMenuItem(page);
  await timeToFrame(page, "pointerdown", `() => (${ownBubble("Following up on Avery's plan.")})() >= 2`);
  await again.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
  await settleDelayedSend(page);
});

test("Send again shows the copy at once and turns it Not delivered with a toast when the bridge fails it", async ({ desk }) => {
  expect((await desk.request.post("/__fixture/fault", { data: { method: "sendText" } })).ok()).toBe(true);
  const page = desk.page;
  const again = await sendAgainMenuItem(page);
  const shown = page.waitForFunction(`(${ownBubble("Following up on Avery's plan.")})() >= 2`, undefined, { polling: "raf", timeout: 5_000 });
  await again.click();
  await shown;
  await expect(page.getByText("Send failed")).toBeVisible();
  await expect(page.getByTestId("thread-view").getByText("Not delivered", { exact: true })).toBeVisible();
});

test("the queue header moves at most once when the fonts arrive after first paint", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(census, REGIONS);
  await page.route(/\.ttf$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await continueHeld(route);
  });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.waitForTimeout(1800);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  expect(shifts.filter((shift) => shift.region === "triage-queue-header").length).toBeLessThanOrEqual(1);
});

const SEEDED = 200;
/** use-messages' first page. */
const FIRST_PAGE = 50;
/** The 50 rows a page adds, plus the seam row whose grouping changes, with slack for list batching. */
const ROW_RENDERS_PER_PAGE = 60;
/** One render when the page is requested, one when it lands. */
const THREAD_RENDERS_PER_PAGE = 2;

type Desk = Parameters<Parameters<typeof test>[2]>[0]["desk"];

/** Opens a 200-message thread and waits for it to settle. */
async function openSeededThread(desk: Desk) {
  const page = desk.page;
  await page.addInitScript(renderCounter);
  for (let i = 1; i <= SEEDED; i++) await desk.receive(desk.chats.needs, `Seeded message ${i}`, desk.chats.needs.split(";").at(-1));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();
  const thread = page.getByTestId("thread-view");
  await expect(thread.getByText(`Seeded message ${SEEDED}`, { exact: true })).toBeVisible();
  // The list mounts the page ten rows a batch after first paint, and a mount counts as a row render. On a slow
  // runner the last batches landed inside the next measurement (PR #89: 20 of an arrival's 22 rows).
  await expect(thread.getByTestId("message-bubble")).toHaveCount(FIRST_PAGE);
  await page.waitForTimeout(600);
  return thread;
}

async function takeRenders(page: Page): Promise<Renders> {
  return page.evaluate(() => {
    const w = window as unknown as { __renders: Renders };
    const taken = { ...w.__renders };
    for (const key of Object.keys(w.__renders) as Array<keyof Renders>) w.__renders[key] = 0;
    return taken;
  });
}

/**
 * Scrolls until the next older page is requested, holds that page, then releases it with no input in
 * flight. Returns the renders it cost, how far the bubble you were reading moved, and the read
 * receipts it sent.
 */
async function landOlderPage(desk: Desk): Promise<{ renders: Renders; moved: number; reads: number }> {
  const page = desk.page;
  let reads = 0;
  let released = false;
  page.on("request", (request) => {
    if (released && request.url().endsWith("/__fixture/convex") && (request.postData() ?? "").includes("markRead")) reads++;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let asked = false;
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string; args: { paginationOpts?: { numItems: number } } };
    if (body.name === "comma/queries:listMessages" && body.args.paginationOpts?.numItems === 100) {
      asked = true;
      await gate;
    }
    await continueHeld(route);
  });
  const thread = await openSeededThread(desk);
  const list = await page.getByTestId("thread-message-list").boundingBox();
  if (!list) throw new Error("thread list not on screen");
  await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
  for (let step = 0; step < 40 && !asked; step++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(50);
  }
  expect(asked, "scrolling up asks for the next older page").toBe(true);
  await page.waitForTimeout(300);
  const anchorText = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="thread-message-list"]')!.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const bubbles = [...document.querySelectorAll('[data-testid="message-bubble"]')];
    bubbles.sort((a, b) => Math.abs(a.getBoundingClientRect().top - middle) - Math.abs(b.getBoundingClientRect().top - middle));
    return bubbles[0]?.textContent ?? "";
  });
  const anchor = thread.getByTestId("message-bubble").filter({ hasText: anchorText }).first();
  const before = (await anchor.boundingBox())!.y;
  await takeRenders(page);
  released = true;
  release();
  await expect(thread.getByText("Seeded message 101", { exact: true })).toBeAttached();
  await page.waitForTimeout(500);
  const after = (await anchor.boundingBox())!.y;
  return { renders: await takeRenders(page), moved: Math.abs(after - before), reads };
}

test("an older page lands without moving the message you are reading", async ({ desk }) => {
  const { moved } = await landOlderPage(desk);
  expect(moved).toBeLessThanOrEqual(1);
});

test("ratchet: an older page renders only its own rows", async ({ desk }) => {
  const { renders } = await landOlderPage(desk);
  console.log(`older page renders: ${JSON.stringify(renders)}`);
  expect(renders.rows).toBeLessThanOrEqual(ROW_RENDERS_PER_PAGE);
});

test("ratchet: an older page renders the thread at most twice and does not mark it read again", async ({ desk }) => {
  const { renders, reads } = await landOlderPage(desk);
  expect(renders.threadView).toBeLessThanOrEqual(THREAD_RENDERS_PER_PAGE);
  expect(reads, "older messages are not new messages").toBe(0);
});

/** The arriving row, the neighbour whose grouping it changes, and their mount-time second pass, with slack. */
const ROW_RENDERS_PER_ARRIVAL = 6;

test("ratchet: an arriving message renders only its row and its neighbour, not the thread", async ({ desk }) => {
  const thread = await openSeededThread(desk);
  await takeRenders(desk.page);
  await desk.receive(desk.chats.needs, "Arrived just now", desk.chats.needs.split(";").at(-1));
  await expect(thread.getByText("Arrived just now", { exact: true })).toBeVisible();
  await desk.page.waitForTimeout(800);
  const renders = await takeRenders(desk.page);
  console.log(`arrival renders: ${JSON.stringify(renders)}`);
  expect(renders.rows).toBeLessThanOrEqual(ROW_RENDERS_PER_ARRIVAL);
});

/**
 * Opening a conversation from the list, then switching to another, from the click to 600 ms after the server's
 * messages painted. Before #80 an open cost 26 commits and 8,136 component renders and a switch 7,109: every shell
 * state change and route change re-rendered both workspaces, and every directory update re-rendered every sidebar
 * cell. Now a laptop measures an open at 25 commits and 3,908 renders and a switch at 2,736. The fixture's agent
 * heartbeat used to change on every 500 ms poll and add commits and a row pass to the window (27 and 4,326 on
 * 05e70b05); it now beats every 30 s, as the runner does. The ceilings sit about 10% above the runner's old reading,
 * still half the old cost.
 */
const OPEN_COMMITS = 30;
const OPEN_COMPONENTS = 4_800;
const SWITCH_COMPONENTS = 3_900;

async function openFromList(page: Page, name: string): Promise<Renders> {
  const before = await page.evaluate(() => (window as unknown as { __commaTimings: unknown[] }).__commaTimings.length);
  await takeRenders(page);
  await page.getByTestId("conversation-row").filter({ hasText: name }).first().click();
  await page.waitForFunction((count) => {
    const timings = (window as unknown as { __commaTimings: Array<{ freshMs: number | null }> }).__commaTimings;
    return timings.length > count && timings.at(-1)?.freshMs != null;
  }, before);
  await page.waitForTimeout(600);
  return takeRenders(page);
}

test("ratchet: opening a conversation, then switching to another, renders the shell only where it changed", async ({ desk }) => {
  const page = desk.page;
  await page.addInitScript(renderCounter);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByTestId("conversation-row").filter({ hasText: "Jordan Lee" })).toBeVisible();
  await page.waitForTimeout(600);
  const open = await openFromList(page, "Alex Rivera");
  const switched = await openFromList(page, "Jordan Lee");
  console.log(`navigation renders: open ${JSON.stringify(open)} switch ${JSON.stringify(switched)}`);
  expect(open.commits, "commits after opening a thread").toBeLessThanOrEqual(OPEN_COMMITS);
  expect(open.components, "components rendered opening a thread").toBeLessThanOrEqual(OPEN_COMPONENTS);
  expect(switched.components, "components rendered switching threads").toBeLessThanOrEqual(SWITCH_COMPONENTS);
});

const TYPED = "See you at the venue around eight thirty";

test("ratchet: each keystroke renders the composer once", async ({ desk }) => {
  const page = desk.page;
  await page.addInitScript(renderCounter);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();
  const input = page.getByPlaceholder("iMessage");
  await input.click();
  await page.waitForTimeout(300);
  await takeRenders(page);
  await page.keyboard.type(TYPED, { delay: 30 });
  await expect(input).toHaveValue(TYPED);
  const renders = await takeRenders(page);
  expect(renders.composer).toBeLessThanOrEqual(TYPED.length + 2);
});

test("ratchet: Send later clears the composer within 50 ms, and a failure puts the text back", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").first().click();
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("Doors at 8, see you then");
  await desk.request.post("/__fixture/send-timing", { data: { delayMs: 300, echo: false } });
  await page.getByRole("button", { name: "Send later" }).click();
  const option = page.getByRole("menuitem").filter({ hasNotText: "Choose Date" }).first();
  await expect(option).toBeVisible();
  await page.evaluate(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    addEventListener("pointerdown", (event) => { ratchet.__inputAt ??= event.timeStamp; }, { capture: true, once: true });
    const poll = (now: number) => {
      const field = document.querySelector('textarea[placeholder="iMessage"]') as HTMLTextAreaElement | null;
      if (field && field.value === "" && ratchet.__inputAt !== undefined) ratchet.__shownAt = now;
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await desk.request.post("/__fixture/fault", { data: { method: "createScheduledMessage", error: "offline" } });
  await option.click();
  const elapsed = await page.waitForFunction(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    return ratchet.__shownAt !== undefined && ratchet.__inputAt !== undefined ? ratchet.__shownAt - ratchet.__inputAt : false;
  }, undefined, { timeout: 5_000 });
  expect(Number(await elapsed.jsonValue())).toBeLessThanOrEqual(50);
  await expect(composer).toHaveValue("Doors at 8, see you then");
  await expect(page.getByText("Couldn't schedule the message. Try again.")).toBeVisible();
  await desk.request.post("/__fixture/fault", { data: { method: null } });
  await desk.request.post("/__fixture/send-timing", { data: {} });
});

test("ratchet: an AI reaction shows on its message within 50 ms of confirming", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").first().click();
  await page.getByRole("button", { name: "react, playful: thumbs up" }).click();
  const confirm = page.getByText("React 👍", { exact: true });
  await expect(confirm).toBeVisible();
  await desk.request.post("/__fixture/send-timing", { data: { delayMs: 300, echo: false } });
  await page.evaluate(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    addEventListener("pointerdown", (event) => { ratchet.__inputAt ??= event.timeStamp; }, { capture: true, once: true });
    const poll = (now: number) => {
      const badge = [...document.querySelectorAll('[data-testid="thread-view"] [aria-label="Like"]')].some((el) => !el.closest('[role="toolbar"]'));
      if (badge && ratchet.__inputAt !== undefined) ratchet.__shownAt = now;
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await confirm.click();
  const elapsed = await page.waitForFunction(() => {
    const ratchet = window as unknown as { __inputAt?: number; __shownAt?: number };
    return ratchet.__shownAt !== undefined && ratchet.__inputAt !== undefined ? ratchet.__shownAt - ratchet.__inputAt : false;
  }, undefined, { timeout: 5_000 });
  expect(Number(await elapsed.jsonValue())).toBeLessThanOrEqual(50);
  await desk.request.post("/__fixture/send-timing", { data: {} });
});

test("Details paints the conversation's people from the list before chatInfo answers", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    if (body.name === "comma/conversationInfo:chatInfo") await released;
    await continueHeld(route);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.keyboard.press("Meta+i");
  await expect(page.getByText("Details", { exact: true })).toBeVisible();
  await expect(page.getByText("Reach Alex at", { exact: true })).toBeVisible({ timeout: 2_000 });
  release();
});

test("a contact search hit for a listed conversation opens it without waiting on findChat", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  let held = true;
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    while (held && body.name === "comma/conversationInfo:findChat") await new Promise((resolve) => setTimeout(resolve, 50));
    await continueHeld(route);
  });
  await page.goto("/search", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Search contacts and messages…").fill("Nina");
  const hit = page.getByText("+16195550201", { exact: true });
  await expect(hit).toBeVisible({ timeout: 5_000 });
  await hit.click();
  await expect(page.getByTestId("thread-view").getByText("Any update when you get a chance?", { exact: true })).toBeVisible({ timeout: 2_000 });
  held = false;
});

const RENAMED = "Crew Prime";
const renamedInDetails = `() => [...document.querySelectorAll('[data-testid="desktop-utility-pane-content"] *')]
  .some((element) => element.childElementCount === 0 && element.textContent === "${RENAMED}")`;

/** Opens Launch Crew's Details and types a new name, ready to save. */
async function renameLaunchCrew(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" }).click();
  await page.keyboard.press("Meta+i");
  await page.getByRole("button", { name: "Rename group" }).click();
  await page.getByPlaceholder("Group name").fill(RENAMED);
  return page.getByRole("button", { name: "Save name" });
}

test("ratchet: a renamed group shows its new name within 50 ms of Save", async ({ desk }) => {
  const page = desk.page;
  // A real bridge takes longer than a frame; the bare fixture can answer inside 50 ms.
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "rename") await new Promise((resolve) => setTimeout(resolve, 300));
    await continueHeld(route);
  });
  const save = await renameLaunchCrew(page);
  await timeToFrame(page, "pointerdown", renamedInDetails);
  await save.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
  await expect(page.getByTestId("conversation-row").filter({ hasText: RENAMED })).toHaveCount(1);
});

test("a group rename shows at once and rolls back with a toast when the bridge fails it", async ({ desk }) => {
  expect((await desk.request.post("/__fixture/fault", { data: { method: "renameGroup" } })).ok()).toBe(true);
  const page = desk.page;
  const save = await renameLaunchCrew(page);
  const shown = page.waitForFunction(`(${renamedInDetails})()`, undefined, { polling: "raf", timeout: 5_000 });
  await save.click();
  await shown;
  await expect(page.getByText("Couldn't rename the conversation. Try again.")).toBeVisible();
  await expect(page.getByTestId("desktop-utility-pane-content").getByText("Launch Crew", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-row").filter({ hasText: RENAMED })).toHaveCount(0);
});

/** The sidebar footer's Scheduled count: no "pending" in its name once nothing is queued. */
const scheduledCountCleared = `() => {
  const button = document.querySelector('[aria-label^="Scheduled"]');
  return button !== null && !/pending/.test(button.getAttribute("aria-label") ?? "");
}`;

/** Opens the Scheduled pane on the seeded message to Jordan and reveals its row actions. */
async function scheduledAction(page: Page, action: "Cancel" | "Send") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Scheduled, 1 pending" })).toBeVisible();
  await page.getByRole("button", { name: "Scheduled, 1 pending" }).click();
  await page.getByText("Checking back tomorrow morning.", { exact: true }).hover();
  return page.getByRole("button", { name: action === "Cancel" ? "Cancel scheduled message to Jordan Lee" : "Send scheduled message to Jordan Lee now" });
}

for (const action of ["Cancel", "Send"] as const) {
  const kind = action === "Cancel" ? "cancelScheduled" : "sendScheduledNow";
  test(`ratchet: ${action === "Cancel" ? "cancelling" : "sending now"} a scheduled message clears the sidebar count within 50 ms`, async ({ desk }) => {
    const page = desk.page;
    // A real bridge takes longer than a frame; the bare fixture can answer inside 50 ms.
    await page.route("**/__fixture/convex", async (route) => {
      const body = route.request().postDataJSON() as { name: string; args: { payload?: { kind: string } } };
      if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === kind) await new Promise((resolve) => setTimeout(resolve, 300));
      await continueHeld(route);
    });
    const button = await scheduledAction(page, action);
    await timeToFrame(page, "pointerdown", scheduledCountCleared);
    await button.click();
    expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
  });

  test(`${action === "Cancel" ? "a cancel" : "a send now"} clears the count at once and restores it when the bridge fails it`, async ({ desk }) => {
    const method = action === "Cancel" ? "deleteScheduledMessage" : "updateScheduledMessage";
    expect((await desk.request.post("/__fixture/fault", { data: { method } })).ok()).toBe(true);
    const page = desk.page;
    const button = await scheduledAction(page, action);
    const cleared = page.waitForFunction(`(${scheduledCountCleared})()`, undefined, { polling: "raf", timeout: 5_000 });
    await button.click();
    await cleared;
    await expect(page.getByRole("button", { name: "Scheduled, 1 pending" })).toBeVisible();
    await expect(page.getByText("Checking back tomorrow morning.", { exact: true })).toBeVisible();
  });
}
