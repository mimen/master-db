import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const text = "verify-imsg conversation identity probe";

type Call = { name: string; args: Record<string, unknown> };

function recordConvex(page: Page): Call[] {
  const calls: Call[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/__fixture/convex")) calls.push(request.postDataJSON() as Call);
  });
  return calls;
}

test("conversation-identity: the client names Alex by his conversation id in the URL, the send, the settle and every query", async ({ desk }) => {
  const page = desk.page;
  const alex = fixtureConversationId(desk.chats.needs);
  const calls = recordConvex(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  await expect(thread).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/c/${alex}$`));
  await page.screenshot({ path: join(evidence, "1-opened.png") });

  const composer = page.getByPlaceholder("iMessage");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(thread.getByText(text, { exact: true })).toHaveCount(1);
  let stored: { text: string; isFromMe: boolean; conversationId: string } | undefined;
  await expect.poll(async () => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId: alex, paginationOpts: { numItems: 50, cursor: null } } },
    });
    const { page: rows } = await response.json() as { page: Array<{ text: string; isFromMe: boolean; conversationId: string }> };
    stored = rows.find((row) => row.text === text && !(row as { guid?: string }).guid?.startsWith("temp-"));
    return stored?.conversationId ?? "";
  }).toBe(alex);

  await page.screenshot({ path: join(evidence, "2-sent.png") });
  writeFileSync(join(evidence, "aria-thread.txt"), await thread.ariaSnapshot());
  await page.keyboard.press("Meta+e");
  await expect.poll(() => calls.filter((call) => call.name === "comma/triage:settle").length).toBe(1);
  await page.screenshot({ path: join(evidence, "3-settled.png") });

  const send = calls.find((call) => call.name === "comma/outbox:enqueue" && (call.args.payload as { kind?: string })?.kind === "send");
  const settle = calls.find((call) => call.name === "comma/triage:settle");
  expect(send?.args.conversationId).toBe(alex);
  expect(settle?.args.conversationId).toBe(alex);
  // Every conversation-scoped call carries an id, never a chat GUID, and nothing resolves one.
  const scoped = calls.filter((call) => typeof call.args.conversationId === "string");
  expect(scoped.length).toBeGreaterThan(3);
  expect(scoped.filter((call) => String(call.args.conversationId).includes(";"))).toEqual([]);
  expect(calls.filter((call) => call.name === "comma/queries:resolveChat")).toEqual([]);

  // An old /chat/<guid> link and a deep link by handle both resolve once at the edge to /c/<id>.
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`/c/${alex}$`));
  await expect(page.getByTestId("thread-view").getByText(text, { exact: true })).toHaveCount(1);
  await page.goto(`/chat/${encodeURIComponent("+16195550101")}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`/c/${alex}$`));
  await page.screenshot({ path: join(evidence, "4-legacy-links-redirected.png") });

  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ alex, send: send?.args, settle: settle?.args, stored,
    scopedCalls: [...new Set(scoped.map((call) => call.name))] }, null, 2));
});

test("conversation-identity: a group's CRM and details read by its conversation id", async ({ desk }) => {
  const page = desk.page;
  const crew = fixtureConversationId(desk.chats.unreadGroup);
  const calls = recordConvex(page);
  await page.goto(`/c/${crew}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("thread-view")).toBeVisible();
  await page.getByRole("button", { name: "Conversation info" }).click();
  await expect(page.getByText("launch", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "5-group-details.png") });
  const info = calls.find((call) => call.name === "comma/conversationInfo:chatInfo");
  expect(info?.args).toEqual({ conversationId: crew });
});
