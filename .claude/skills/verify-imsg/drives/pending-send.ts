import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;

type Row = { guid: string; text: string; sendState?: string; clientKey?: string };

/** The thread as the client reads it from Convex. */
async function stored(request: APIRequestContext, conversationId: string): Promise<Row[]> {
  const response = await request.post("/__fixture/convex", {
    data: { name: "comma/queries:listMessages", args: { conversationId, paginationOpts: { numItems: 50, cursor: null } } },
  });
  return ((await response.json()) as { page: Row[] }).page;
}

function outboxCalls(page: Page): Array<{ name: string; args: Record<string, unknown> }> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: Record<string, unknown> };
    const send = body.name === "comma/outbox:enqueue" && (body.args.payload as { kind?: string } | undefined)?.kind === "send";
    if (send || body.name.startsWith("comma/pendingSends:")) calls.push(body);
  });
  return calls;
}

async function openAlex(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  await expect(thread).toBeVisible();
  return thread;
}

/**
 * The fixture's client reads navigator.onLine as its Convex socket. A flag in localStorage drives it here, because a
 * reload needs the network that page.context().setOffline would cut, and the flag survives the reload.
 */
async function deviceSwitch(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => localStorage.getItem("verify.offline") !== "1" });
  });
  return async (online: boolean) => page.evaluate((on) => {
    localStorage.setItem("verify.offline", on ? "0" : "1");
    dispatchEvent(new Event(on ? "online" : "offline"));
  }, online);
}

const keptKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("imsg.pendingSend.v1:")));
const sendEnqueues = (calls: Array<{ name: string; args: Record<string, unknown> }>) =>
  calls.filter((call) => call.name === "comma/outbox:enqueue").map((call) => String(call.args.clientKey));

async function reopenAlex(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  const thread = page.getByTestId("thread-view");
  if (!(await thread.isVisible().catch(() => false))) await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await expect(thread).toBeVisible();
  return thread;
}

async function send(page: Page, text: string): Promise<number> {
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill(text);
  await composer.press("Enter");
  return Date.now();
}

test("pending-send: with the Mini away a send says Waiting at once, Cancel takes it back, and reconnect sends the rest", async ({ desk }) => {
  const page = desk.page;
  const calls = outboxCalls(page);
  const conversationId = fixtureConversationId(desk.chats.needs);
  const thread = await openAlex(page);
  await desk.request.post("/__fixture/mini", { data: { online: false } });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: join(evidence, "1-before.png") });

  const cancelText = "pending-send cancel probe";
  const sentAt = await send(page, cancelText);
  await expect(thread.getByText("Waiting to send")).toBeVisible({ timeout: 1_500 });
  const waitingAfterMs = Date.now() - sentAt;
  await page.screenshot({ path: join(evidence, "2-waiting.png") });
  await expect.poll(async () => (await stored(desk.request, conversationId)).find((row) => row.text === cancelText)?.sendState).toBe("queued");

  await thread.getByRole("button", { name: "Cancel sending" }).click();
  await expect(thread.getByText(cancelText, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "3-cancelled.png") });
  const cancelKey = String(calls.find((call) => call.name === "comma/outbox:enqueue")?.args.clientKey);
  const cancelledRow = await desk.request.post("/__fixture/convex", { data: { name: "comma/outbox:outboxStatusFor", args: { clientKeys: [cancelKey] } } });
  expect(await cancelledRow.json()).toEqual([]);

  const reconnectText = "pending-send reconnect probe";
  await send(page, reconnectText);
  await expect(thread.getByText("Waiting to send")).toBeVisible({ timeout: 1_500 });
  await page.screenshot({ path: join(evidence, "4-waiting-again.png") });
  await desk.request.post("/__fixture/mini", { data: { online: true } });
  await expect(thread.getByText("Waiting to send")).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(async () => (await stored(desk.request, conversationId)).find((row) => row.text === reconnectText)?.guid ?? "").toMatch(/^out-/);
  await expect(thread.getByText(reconnectText, { exact: true })).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "5-sent-on-reconnect.png") });

  const rows = await stored(desk.request, conversationId);
  writeFileSync(join(evidence, "aria-mini-away.txt"), await thread.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects-mini-away.json"), JSON.stringify({ waitingAfterMs, calls, rows: rows.filter((row) => row.text.startsWith("pending-send")) }, null, 2));
  expect(rows.some((row) => row.text === cancelText)).toBe(false);
  expect(calls.map((call) => call.name)).toEqual(["comma/outbox:enqueue", "comma/pendingSends:cancelSend", "comma/outbox:enqueue"]);
});

test("pending-send: a send nothing takes in time shows Not sent, stays unsent when the Mini returns, and Retry sends it", async ({ desk }) => {
  const page = desk.page;
  const calls = outboxCalls(page);
  const conversationId = fixtureConversationId(desk.chats.needs);
  const thread = await openAlex(page);
  await desk.request.post("/__fixture/mini", { data: { online: false, notSentAfterMs: 3_000 } });

  const text = "pending-send timeout probe";
  await send(page, text);
  await expect(thread.getByText("Waiting to send")).toBeVisible({ timeout: 5_000 });
  await expect(thread.getByText("Not sent", { exact: true })).toBeVisible({ timeout: 6_000 });
  await page.screenshot({ path: join(evidence, "6-not-sent.png") });
  expect((await stored(desk.request, conversationId)).find((row) => row.text === text)?.sendState).toBe("notSent");

  await desk.request.post("/__fixture/mini", { data: { online: true } });
  await page.waitForTimeout(1_500);
  await expect(thread.getByText("Not sent", { exact: true })).toBeVisible();
  expect((await stored(desk.request, conversationId)).find((row) => row.text === text)?.guid).toMatch(/^temp-/);

  await thread.getByRole("button", { name: "Retry sending" }).click();
  await expect(thread.getByText("Not sent", { exact: true })).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(async () => (await stored(desk.request, conversationId)).filter((row) => row.text === text).map((row) => row.guid.slice(0, 4))).toEqual(["out-"]);
  await expect(thread.getByText(text, { exact: true })).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "7-retried.png") });
  writeFileSync(join(evidence, "aria-timeout.txt"), await thread.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects-timeout.json"), JSON.stringify({ calls, rows: (await stored(desk.request, conversationId)).filter((row) => row.text === text) }, null, 2));
  expect(calls.map((call) => call.name)).toEqual(["comma/outbox:enqueue", "comma/pendingSends:retrySend"]);
});

test("pending-send: with the browser offline a send waits on this device and goes out when it reconnects", async ({ desk }) => {
  const page = desk.page;
  const calls = outboxCalls(page);
  const conversationId = fixtureConversationId(desk.chats.needs);
  const thread = await openAlex(page);
  await page.context().setOffline(true);

  const text = "pending-send offline probe";
  const sentAt = await send(page, text);
  await expect(thread.getByText("Waiting to send")).toBeVisible({ timeout: 1_500 });
  const waitingAfterMs = Date.now() - sentAt;
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: join(evidence, "8-offline-waiting.png") });
  const whileOffline = calls.length;

  await page.context().setOffline(false);
  await expect(thread.getByText("Waiting to send")).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(async () => (await stored(desk.request, conversationId)).find((row) => row.text === text)?.guid ?? "").toMatch(/^out-/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "9-offline-sent.png") });
  writeFileSync(join(evidence, "aria-offline.txt"), await thread.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects-offline.json"), JSON.stringify({ waitingAfterMs, enqueuedWhileOffline: whileOffline, calls }, null, 2));
  expect(whileOffline).toBe(0);
  expect(calls.map((call) => call.name)).toEqual(["comma/outbox:enqueue"]);
});

test("pending-send: a send held offline survives a reload, and reconnect sends exactly one copy under its key", async ({ desk }) => {
  const page = desk.page;
  const calls = outboxCalls(page);
  const conversationId = fixtureConversationId(desk.chats.needs);
  const setOnline = await deviceSwitch(page);
  await openAlex(page);
  await setOnline(false);

  const text = "pending-send reload probe";
  await send(page, text);
  await expect(page.getByTestId("thread-view").getByText("Waiting to send")).toBeVisible({ timeout: 1_500 });
  const kept = await keptKeys(page);
  expect(kept).toHaveLength(1);
  const clientKey = kept[0]!.slice("imsg.pendingSend.v1:".length);
  await page.screenshot({ path: join(evidence, "10-before-reload.png") });

  const thread = await reopenAlex(page);
  await expect(thread.getByText(text, { exact: true })).toBeVisible();
  await expect(thread.getByText("Waiting to send")).toBeVisible();
  await page.screenshot({ path: join(evidence, "11-restored-after-reload.png") });
  expect(sendEnqueues(calls)).toEqual([]);

  await setOnline(true);
  await expect.poll(async () => (await stored(desk.request, conversationId)).filter((row) => row.text === text).map((row) => row.guid.slice(0, 4))).toEqual(["out-"]);
  await expect(thread.getByText("Waiting to send")).toHaveCount(0, { timeout: 5_000 });
  await page.waitForTimeout(1_500);
  await expect(thread.getByText(text, { exact: true })).toHaveCount(1);
  await page.screenshot({ path: join(evidence, "12-sent-after-reload.png") });
  writeFileSync(join(evidence, "aria-reload.txt"), await thread.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects-reload.json"), JSON.stringify({ clientKey, calls, keptAfter: await keptKeys(page),
    rows: (await stored(desk.request, conversationId)).filter((row) => row.text === text) }, null, 2));
  expect(sendEnqueues(calls)).toEqual([clientKey]);
  expect(await keptKeys(page)).toEqual([]);
});

test("pending-send: cancel after a reload takes the send back for good", async ({ desk }) => {
  const page = desk.page;
  const calls = outboxCalls(page);
  const conversationId = fixtureConversationId(desk.chats.needs);
  const setOnline = await deviceSwitch(page);
  await openAlex(page);
  await setOnline(false);

  const text = "pending-send cancel-after-reload probe";
  await send(page, text);
  await expect(page.getByTestId("thread-view").getByText("Waiting to send")).toBeVisible({ timeout: 1_500 });
  let thread = await reopenAlex(page);
  await expect(thread.getByText(text, { exact: true })).toBeVisible();
  await thread.getByRole("button", { name: "Cancel sending" }).click();
  await expect(thread.getByText(text, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "13-cancelled-after-reload.png") });
  expect(await keptKeys(page)).toEqual([]);

  thread = await reopenAlex(page);
  await setOnline(true);
  await page.waitForTimeout(2_000);
  await expect(thread.getByText(text, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "14-still-gone-online.png") });
  const rows = (await stored(desk.request, conversationId)).filter((row) => row.text === text);
  writeFileSync(join(evidence, "side-effects-cancel-after-reload.json"), JSON.stringify({ calls, rows }, null, 2));
  expect(sendEnqueues(calls)).toEqual([]);
  expect(rows).toEqual([]);
});

test("pending-send: with the Mini up but not taking sends, Waiting shows after about a second, and a healthy send never shows it", async ({ desk }) => {
  const page = desk.page;
  const conversationId = fixtureConversationId(desk.chats.needs);
  const thread = await openAlex(page);
  await page.evaluate(() => {
    const seen = { waiting: false };
    (window as unknown as { __captions: typeof seen }).__captions = seen;
    new MutationObserver(() => { if (document.body.innerText.includes("Waiting to send")) seen.waiting = true; })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // A healthy send whose Convex round trip takes 600 ms.
  await desk.request.post("/__fixture/latency", { data: { name: "comma/outbox:enqueue", delayMs: 600 } });
  const healthy = "pending-send healthy probe";
  await send(page, healthy);
  await expect.poll(async () => (await stored(desk.request, conversationId)).find((row) => row.text === healthy)?.guid ?? "").toMatch(/^out-/);
  await page.waitForTimeout(1_500);
  const healthyShowedWaiting = await page.evaluate(() => (window as unknown as { __captions: { waiting: boolean } }).__captions.waiting);
  await desk.request.post("/__fixture/latency", { data: { name: "comma/outbox:enqueue", delayMs: null } });

  await desk.request.post("/__fixture/mini", { data: { online: false, heartbeat: true } });
  const stuck = "pending-send stuck probe";
  const sentAt = await send(page, stuck);
  await expect(thread.getByText("Waiting to send")).toBeVisible({ timeout: 3_000 });
  const waitingAfterMs = Date.now() - sentAt;
  await page.screenshot({ path: join(evidence, "15-waiting-mini-up.png") });
  expect(await page.evaluate(() => (window as unknown as { __captions: { waiting: boolean } }).__captions.waiting), "the caption watcher sees Waiting when it shows").toBe(true);

  await desk.request.post("/__fixture/send-timing", { data: { delayMs: 3_000, echo: false } });
  await desk.request.post("/__fixture/mini", { data: { online: true } });
  await expect(thread.getByText("Sending…")).toBeVisible({ timeout: 2_000 });
  await page.screenshot({ path: join(evidence, "16-sending-after-wait.png") });
  await expect.poll(async () => (await stored(desk.request, conversationId)).find((row) => row.text === stuck)?.guid ?? "", { timeout: 10_000 }).toMatch(/^out-/);
  writeFileSync(join(evidence, "caption-timing.json"), JSON.stringify({ healthyShowedWaiting, waitingAfterMs }, null, 2));
  expect(healthyShowedWaiting).toBe(false);
  expect(waitingAfterMs).toBeGreaterThan(700);
  expect(waitingAfterMs).toBeLessThan(2_000);
});
