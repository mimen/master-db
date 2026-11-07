import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (name: string) => join(evidence, `${name}.png`);
const JORDAN = "+16195550102";
const GROUP_TEXT = "Can someone grab the projector for load-in?";

test("person-context: a DM's agent reads what its person said in a group and quotes it", async ({ desk }) => {
  test.setTimeout(60_000);
  const page = desk.page;
  const asks: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: Record<string, unknown> };
    if (body.name === "comma/agent:ask") asks.push(body.args);
  });

  await desk.receive(desk.chats.unreadGroup, GROUP_TEXT, JORDAN);
  await page.goto(`/chat/${encodeURIComponent(desk.chats.waiting)}`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+j");
  const pane = page.getByTestId("agent-pane");
  await expect(pane).toBeVisible();
  await page.screenshot({ path: shot("01-before") });

  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await input.fill("what did they say elsewhere?");
  await input.press("Enter");
  const reply = pane.getByTestId("agent-reply");
  await expect(reply).toContainText("Elsewhere, Jordan Lee wrote in group Launch Crew");
  await expect(reply).toContainText(GROUP_TEXT);

  const turn = pane.getByTestId("agent-turn").first();
  await turn.getByRole("button", { name: /^Worked for / }).click();
  await turn.getByRole("button", { name: /^Ran \d+ commands/ }).click();
  await turn.getByRole("button", { name: "Read their other conversations" }).click();
  const detail = turn.getByTestId("agent-step-detail").first();
  await expect(detail).toContainText(`Jordan Lee in group "Launch Crew" (imessage): ${GROUP_TEXT}`);
  await expect(detail).toContainText("<person_messages>");
  await page.screenshot({ path: shot("02-reply-and-step") });
  writeFileSync(join(evidence, "aria.txt"), await pane.ariaSnapshot());

  const conversationId = fixtureConversationId(desk.chats.waiting);
  expect(asks, "the pane enqueued one ask on Jordan's DM").toEqual([expect.objectContaining({ conversationId, text: "what did they say elsewhere?" })]);
  const convex = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await desk.request.post("/__fixture/convex", { data: { name, args } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<T>;
  };
  const [chat] = await convex<Array<{ _id: string; state: string }>>("comma/agent:chatsFor", { conversationId });
  expect(chat?.state).toBe("idle");
  const items = await convex<Array<{ entry: { kind: string; name?: string; detail?: string } }>>("comma/agent:listItems", { chatId: chat!._id });
  const step = items.find((item) => item.entry.name === "mcp__comma__read_person")?.entry;
  expect(step?.detail, "the stored step carries the fenced group line").toContain(GROUP_TEXT);
  writeFileSync(join(evidence, "items.json"), JSON.stringify(items, null, 2));
});
