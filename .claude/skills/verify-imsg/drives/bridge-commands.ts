import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const INBOUND = "Can you send the final arrival time?";

type Desk = { page: Page; request: Page["request"]; chats: Record<string, string> };

/** Commands the client enqueues, minus the suggestions fetch every thread open fires. */
function enqueued(page: Page): Array<{ kind: string }> {
  const sent: Array<{ kind: string }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload && body.args.payload.kind !== "suggestions") sent.push(body.args.payload);
    if (body.name === "comma/triage:markRead") sent.push({ kind: "triage:markRead" });
  });
  return sent;
}

async function convex<T>(desk: Desk, name: string, args: Record<string, unknown>): Promise<T> {
  return (await desk.request.post("/__fixture/convex", { data: { name, args } })).json() as Promise<T>;
}

type Row = { guid: string; text: string; reactions: Array<{ type: string; isFromMe: boolean }> };
const thread = async (desk: Desk) => (await convex<{ page: Row[] }>(desk, "comma/queries:listMessages",
  { conversationId: fixtureConversationId(desk.chats.needs), paginationOpts: { numItems: 50, cursor: null } })).page;

async function openAlex(page: Page, path = "/") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await expect(page.getByTestId("thread-view")).toBeVisible();
}

function record(name: string, value: unknown) {
  writeFileSync(join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
}

test("react: a tapback from the tray reaches the bridge and lands on the message", async ({ desk }) => {
  const page = desk.page;
  const sent = enqueued(page);
  await openAlex(page);
  await page.screenshot({ path: join(evidence, "react-1-before.png") });
  await page.getByTestId("thread-view").getByRole("button", { name: `Alex Rivera: ${INBOUND}` }).click({ button: "right" });
  await page.getByRole("toolbar", { name: "Tapbacks" }).getByRole("button", { name: "Love", exact: true }).click();
  await expect(page.getByTestId("thread-view").getByRole("button", { name: "Love", exact: true })).toBeVisible();
  await expect.poll(async () => (await thread(desk)).find((row) => row.text === INBOUND)?.reactions.filter((r) => r.isFromMe).map((r) => r.type)).toEqual(["love"]);
  await page.screenshot({ path: join(evidence, "react-2-after.png") });
  writeFileSync(join(evidence, "react-aria.txt"), await page.getByTestId("thread-view").ariaSnapshot());
  record("react-side-effects", { sent, stored: (await thread(desk)).find((row) => row.text === INBOUND) });
  // Opening the thread reads it too; this drive cares about the react.
  expect(sent.filter((payload) => payload.kind === "react")).toEqual([expect.objectContaining({ kind: "react", reaction: "love" })]);
});

test("delete: Delete for Me removes the message from the mirrored thread", async ({ desk }) => {
  const page = desk.page;
  const sent = enqueued(page);
  await openAlex(page);
  const before = await thread(desk);
  await page.screenshot({ path: join(evidence, "delete-1-before.png") });
  await page.getByTestId("thread-view").getByRole("button", { name: `Alex Rivera: ${INBOUND}` }).click({ button: "right" });
  await page.getByText("Delete for Me", { exact: true }).click();
  await expect(page.getByText("Deleted", { exact: true })).toBeVisible();
  await expect(page.getByTestId("thread-view").getByText(INBOUND, { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await thread(desk)).some((row) => row.text === INBOUND)).toBe(false);
  await page.screenshot({ path: join(evidence, "delete-2-after.png") });
  writeFileSync(join(evidence, "delete-aria.txt"), await page.getByTestId("thread-view").ariaSnapshot());
  record("delete-side-effects", { sent, before: before.map((row) => row.guid), after: (await thread(desk)).map((row) => row.guid) });
  expect(sent.filter((payload) => payload.kind === "delete")).toEqual([expect.objectContaining({ kind: "delete", messageGuid: before.find((row) => row.text === INBOUND)!.guid })]);
});

async function markLaunchCrewRead(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  const row = page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" });
  await expect(row).toHaveAttribute("aria-label", /^Launch Crew, unread,/);
  await page.screenshot({ path: join(evidence, "read-1-before.png") });
  await row.hover();
  await row.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("dialog").getByText("Mark as read", { exact: true }).click();
  return row;
}

test("mark read: the row menu clears the unread group and sends the receipt", async ({ desk }) => {
  const page = desk.page;
  const sent = enqueued(page);
  const row = await markLaunchCrewRead(page);
  await expect(row).toHaveAttribute("aria-label", /^Launch Crew, (?!unread)/);
  const conversation = () => convex<{ unreadCount: number; flags: { unread: boolean } }>(desk, "comma/queries:getConversation", { conversationId: fixtureConversationId(desk.chats.unreadGroup) });
  await expect.poll(async () => (await conversation()).unreadCount).toBe(0);
  await expect.poll(() => sent.map((payload) => payload.kind)).toEqual(["triage:markRead"]);
  // A failed receipt rolls the row back with a toast; give it time to show if it were coming.
  await page.waitForTimeout(500);
  await expect(page.getByText("Couldn't mark as read. Try again.")).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-label", /^Launch Crew, (?!unread)/);
  await page.screenshot({ path: join(evidence, "read-2-after.png") });
  writeFileSync(join(evidence, "read-aria.txt"), await row.ariaSnapshot());
  record("read-side-effects", { sent, stored: await conversation() });
});

test("mark read: a receipt BlueBubbles refuses rolls the row back, so the receipt really runs", async ({ desk }) => {
  expect((await desk.request.post("/__fixture/fault", { data: { method: "markRead" } })).ok()).toBe(true);
  const page = desk.page;
  const row = await markLaunchCrewRead(page);
  await expect(page.getByText("Couldn't mark as read. Try again.")).toBeVisible();
  await expect(row).toHaveAttribute("aria-label", /^Launch Crew, unread,/);
  await page.screenshot({ path: join(evidence, "read-3-fault-rollback.png") });
});

test("scheduled: Send later queues the message, and cancelling the seeded one removes it", async ({ desk }) => {
  const page = desk.page;
  const sent = enqueued(page);
  await openAlex(page, "/?schedule");
  await page.getByPlaceholder("iMessage").fill("Doors at 8");
  await page.getByRole("button", { name: "Send later" }).click();
  await page.getByText("Choose Date & Time…", { exact: true }).click();
  // The editor defaults to the current minute, which is already past by the time Save lands.
  const tomorrow = new Date(Date.now() + 86_400_000);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await page.getByText("Choose Date & Time", { exact: true }).locator("xpath=..").locator("input").first().fill(day);
  await page.screenshot({ path: join(evidence, "schedule-1-editor.png") });
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByPlaceholder("iMessage")).toHaveValue("");
  type Scheduled = { bbId: number; text: string; status: string; chatGuid: string };
  const scheduled = () => convex<Scheduled[]>(desk, "comma/queries:listScheduled", {});
  await expect.poll(async () => (await scheduled()).find((item) => item.text === "Doors at 8")?.status).toBe("pending");

  await page.getByRole("button", { name: /^Scheduled, 2 pending/ }).click();
  await expect(page.getByText("Doors at 8", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "schedule-2-list.png") });
  await page.getByText("Checking back tomorrow morning.", { exact: true }).hover();
  await page.getByRole("button", { name: "Cancel scheduled message to Jordan Lee" }).click();
  await expect(page.getByText("Checking back tomorrow morning.", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await scheduled()).map((item) => item.text)).toEqual(["Doors at 8"]);
  await page.screenshot({ path: join(evidence, "schedule-3-cancelled.png") });
  writeFileSync(join(evidence, "schedule-aria.txt"), await page.locator("body").ariaSnapshot());
  record("schedule-side-effects", { sent, stored: await scheduled() });
  const scheduling = sent.filter((payload) => payload.kind === "schedule" || payload.kind === "cancelScheduled");
  expect(scheduling).toEqual([expect.objectContaining({ kind: "schedule", text: "Doors at 8" }), expect.objectContaining({ kind: "cancelScheduled" })]);
});
