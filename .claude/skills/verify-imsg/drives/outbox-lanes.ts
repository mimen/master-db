import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const INBOUND = "Can you send the final arrival time?";
const TEXT = "verify-imsg outbox-lanes probe";
const SLOW_MS = 10_000;

type Enqueue = { at: number; clientKey: string; kind: string };

test("outbox-lanes: a tapback and a send land while a slow suggestions command holds the AI lane, then the suggestion lands", async ({ desk }) => {
  const page = desk.page;
  const convex = async <T>(name: string, args: Record<string, unknown>): Promise<T> =>
    (await desk.request.post("/__fixture/convex", { data: { name, args } })).json() as Promise<T>;
  const status = async (clientKey: string) =>
    (await convex<Array<{ status: string }>>("comma/outbox:outboxStatusFor", { clientKeys: [clientKey] }))[0]?.status ?? "in flight";
  const enqueued: Enqueue[] = [];
  const start = Date.now();
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { clientKey?: string; payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload) {
      enqueued.push({ at: Date.now() - start, clientKey: body.args.clientKey!, kind: body.args.payload.kind });
    }
  });
  await desk.request.post("/__fixture/latency", { data: { name: "outbox:suggestions", delayMs: SLOW_MS } });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  await expect.poll(() => enqueued.find((row) => row.kind === "suggestions")?.clientKey ?? "").not.toBe("");
  const suggestions = enqueued.find((row) => row.kind === "suggestions")!;
  await expect(page.getByTestId("composer-ghost")).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "1-ai-lane-busy.png") });

  await thread.getByRole("button", { name: `Alex Rivera: ${INBOUND}` }).click({ button: "right" });
  await page.getByRole("toolbar", { name: "Tapbacks" }).getByRole("button", { name: "Like", exact: true }).click();
  await expect.poll(async () => {
    const react = enqueued.find((row) => row.kind === "react");
    return react ? status(react.clientKey) : "not enqueued";
  }, { timeout: 5_000 }).toBe("sent");
  const react = enqueued.find((row) => row.kind === "react")!;
  const reactedAt = Date.now() - start;
  expect(await status(suggestions.clientKey), "the tapback landed before the slow suggestions command finished").toBe("in flight");

  // The send goes to another conversation, so Alex's thread still ends inbound and keeps its suggestion.
  await page.goto(`/chat/${encodeURIComponent(desk.chats.waiting)}?name=Jordan%20Lee`, { waitUntil: "domcontentloaded" });
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill(TEXT);
  await composer.press("Enter");
  await expect.poll(async () => {
    const send = enqueued.find((row) => row.kind === "send");
    return send ? status(send.clientKey) : "not enqueued";
  }, { timeout: 5_000 }).toBe("sent");
  const send = enqueued.find((row) => row.kind === "send")!;
  const sentAt = Date.now() - start;
  expect(await status(suggestions.clientKey), "the send landed before the slow suggestions command finished").toBe("in flight");
  await expect(page.getByTestId("thread-view").getByText(TEXT, { exact: true })).toHaveCount(1);
  await page.screenshot({ path: join(evidence, "2-send-landed-ai-lane-busy.png") });

  await expect.poll(() => status(suggestions.clientKey), { timeout: SLOW_MS + 5_000 }).toBe("sent");
  const suggestedAt = Date.now() - start;
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("composer-ghost")).toHaveText("what time do you need the final answer by?");
  await expect(page.getByTestId("thread-view").getByRole("button", { name: "Like", exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "3-suggestion-and-tapback.png") });
  writeFileSync(join(evidence, "aria.txt"), await page.getByTestId("thread-view").ariaSnapshot());

  type Rows = { page: Array<{ guid: string; text: string; reactions: Array<{ type: string; isFromMe: boolean }> }> };
  const messages = (conversationId: string) => convex<Rows>("comma/queries:listMessages", { conversationId, paginationOpts: { numItems: 50, cursor: null } });
  const stored = {
    send: (await messages(desk.chats.waiting)).page.find((row) => row.text === TEXT),
    tapbacks: (await messages(desk.chats.needs)).page.find((row) => row.text === INBOUND)?.reactions.filter((r) => r.isFromMe),
  };
  const timeline = { suggestionsEnqueuedAt: suggestions.at, sendEnqueuedAt: send.at, sentAt, reactEnqueuedAt: react.at, reactedAt, suggestedAt, slowMs: SLOW_MS };
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ timeline, enqueued, stored }, null, 2));
  expect(stored.send?.guid).toMatch(/^out-/);
  expect(stored.tapbacks?.map((r) => r.type)).toEqual(["like"]);
  expect(suggestedAt - suggestions.at, "the suggestions command really ran slow").toBeGreaterThanOrEqual(SLOW_MS);
});
