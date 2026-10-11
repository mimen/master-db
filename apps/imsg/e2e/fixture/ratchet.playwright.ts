import type { Page } from "@playwright/test";
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
    await route.continue();
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

test("ratchet: a forwarded message is in the destination thread within 50 ms of the click", async ({ desk }) => {
  // A real bridge takes longer than a frame; the bare fixture can answer inside 50 ms.
  expect((await desk.request.post("/__fixture/send-timing", { data: { delayMs: 300 } })).ok()).toBe(true);
  const page = desk.page;
  const jordan = await forwardToJordan(page);
  await timeToFrame(page, "pointerdown", FORWARDED);
  await jordan.click();
  expect(await elapsedToFrame(page)).toBeLessThanOrEqual(50);
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
  await expect(page.getByText("+16195550101").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Alex Rivera" })).toBeVisible();
  await page.getByPlaceholder("iMessage").last().fill(text);
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
    await route.continue();
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
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.waitForTimeout(1800);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: Shift[] }).__shifts);
  expect(shifts.filter((shift) => shift.region === "triage-queue-header").length).toBeLessThanOrEqual(1);
});

const SEEDED = 200;
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
    await route.continue();
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
