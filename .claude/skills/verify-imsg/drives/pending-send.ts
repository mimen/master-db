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
