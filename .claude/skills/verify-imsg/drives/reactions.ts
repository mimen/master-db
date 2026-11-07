import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const INBOUND = "Can you send the final arrival time?";
const MINE = "The venue walkthrough is confirmed.";
const ALEX = "+16195550101";

type Row = { guid: string; text: string; reactions: Array<{ key: string; emoji?: string; isFromMe: boolean; senderName: string | null }> };

test("reactions: react, change, remove; a peer's reactions come and go", async ({ desk }) => {
  const page = desk.page;
  const enqueued: unknown[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "react") enqueued.push(body.args.payload);
  });
  const rows = async () => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId: fixtureConversationId(desk.chats.needs), paginationOpts: { numItems: 50, cursor: null } } },
    });
    return (await response.json() as { page: Row[] }).page;
  };
  const reactionsOn = async (text: string) => (await rows()).find((row) => row.text === text)?.reactions ?? [];
  const mine = async () => (await reactionsOn(INBOUND)).filter((r) => r.isFromMe).map((r) => r.key);
  const tapback = (targetGuid: string, reaction: string) =>
    desk.request.post("/__fixture/tapback", { data: { chatGuid: desk.chats.needs, targetGuid, reaction, handle: ALEX } });
  const stored: Record<string, unknown> = {};

  expect((await tapback("needs-1", "love")).ok()).toBe(true);
  stored.peerLove = await reactionsOn(MINE);
  expect(stored.peerLove).toEqual([{ key: "love", emoji: "❤️", isFromMe: false, senderName: "Alex Rivera", senderAddress: ALEX, type: "love" }]);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  const chip = (name: string) => thread.getByRole("button", { name, exact: true });
  await expect(chip("Love")).toBeVisible();
  await page.screenshot({ path: join(evidence, "1-peer-love.png") });

  const bubble = thread.getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  const pick = async (name: string) => {
    await bubble.click({ button: "right" });
    await tray.getByRole("button", { name, exact: true }).click();
    await expect(tray).toHaveCount(0);
  };

  // React.
  await pick("Like");
  await expect(chip("Like")).toBeVisible();
  await expect.poll(mine).toEqual(["like"]);
  await page.screenshot({ path: join(evidence, "2-react-like.png") });

  // Change: the tray toggles each tapback, so a change is Laugh on and Like off.
  await pick("Laugh");
  await expect.poll(mine).toEqual(["like", "laugh"]);
  await pick("Remove Like");
  await expect.poll(mine).toEqual(["laugh"]);
  await expect(chip("Like")).toHaveCount(0);
  await expect(chip("Laugh")).toBeVisible();
  stored.afterChange = await reactionsOn(INBOUND);
  await page.screenshot({ path: join(evidence, "3-changed-to-laugh.png") });

  // Remove.
  await pick("Remove Laugh");
  await expect.poll(mine).toEqual([]);
  await expect(chip("Laugh")).toHaveCount(0);

  // Alex adds a second reaction, then takes back the love.
  expect((await tapback("needs-1", "emphasize")).ok()).toBe(true);
  await expect(chip("Emphasize")).toBeVisible();
  await expect(chip("Love")).toBeVisible();
  expect((await tapback("needs-1", "-love")).ok()).toBe(true);
  await expect(chip("Love")).toHaveCount(0);
  await expect(chip("Emphasize")).toBeVisible();
  stored.peerAfterRemoval = await reactionsOn(MINE);
  expect(stored.peerAfterRemoval).toEqual([expect.objectContaining({ key: "emphasize", emoji: "‼️", isFromMe: false, senderName: "Alex Rivera" })]);
  await page.screenshot({ path: join(evidence, "4-peer-new-form.png") });

  writeFileSync(join(evidence, "aria.txt"), await thread.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ enqueued, stored }, null, 2));
  expect(enqueued).toEqual([
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "like", remove: false }),
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "laugh", remove: false }),
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "like", remove: true }),
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "laugh", remove: true }),
  ]);
});
