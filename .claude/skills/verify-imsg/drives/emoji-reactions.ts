import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const INBOUND = "Can you send the final arrival time?";
const MINE = "The venue walkthrough is confirmed.";
const ALEX = "+16195550101";

type Row = { text: string; reactions: Array<{ key: string; emoji?: string; isFromMe: boolean; senderName: string | null }> };

test("emoji-reactions: send, change and remove an emoji reaction; a peer's shows; greyed when the Mac can't", async ({ desk }) => {
  const page = desk.page;
  const enqueued: unknown[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "react") enqueued.push(body.args.payload);
  });
  const reactionsOn = async (text: string) => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId: fixtureConversationId(desk.chats.needs), paginationOpts: { numItems: 50, cursor: null } } },
    });
    return (await response.json() as { page: Row[] }).page.find((row) => row.text === text)?.reactions ?? [];
  };
  const mine = async () => (await reactionsOn(INBOUND)).filter((r) => r.isFromMe).map((r) => r.key);
  const stored: Record<string, unknown> = {};

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  const chip = (name: string) => thread.getByRole("button", { name, exact: true });
  const bubble = thread.getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  const picker = page.getByRole("dialog", { name: "Emoji reactions" });

  await bubble.click({ button: "right" });
  await tray.getByRole("button", { name: "More reactions" }).click();
  await expect(picker).toBeVisible();
  await page.screenshot({ path: join(evidence, "1-picker.png") });
  await picker.getByRole("button", { name: "🔥", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(chip("🔥")).toBeVisible();
  await expect.poll(mine).toEqual(["emoji:🔥"]);
  await page.screenshot({ path: join(evidence, "2-sent-fire.png") });

  await bubble.click({ button: "right" });
  await expect(tray.getByRole("button", { name: "Remove 🔥" })).toHaveAttribute("aria-selected", "true");
  await tray.getByRole("button", { name: "More reactions" }).click();
  await picker.getByLabel("Any emoji").fill("🫶🏽");
  await expect(picker).toHaveCount(0);
  await expect(chip("🫶🏽")).toBeVisible();
  await expect(chip("🔥")).toHaveCount(0);
  await expect.poll(mine).toEqual(["emoji:🫶🏽"]);
  stored.afterChange = await reactionsOn(INBOUND);
  await page.screenshot({ path: join(evidence, "3-changed-heart-hands.png") });

  await bubble.click({ button: "right" });
  await tray.getByRole("button", { name: "Remove 🫶🏽" }).click();
  await expect(chip("🫶🏽")).toHaveCount(0);
  await expect.poll(mine).toEqual([]);

  const peer = await desk.request.post("/__fixture/tapback", { data: { chatGuid: desk.chats.needs, targetGuid: "needs-1", reaction: "😮", handle: ALEX } });
  expect(peer.ok()).toBe(true);
  await expect(chip("😮")).toBeVisible();
  stored.peer = await reactionsOn(MINE);
  expect(stored.peer).toEqual([expect.objectContaining({ key: "emoji:😮", emoji: "😮", isFromMe: false, senderName: "Alex Rivera" })]);
  await page.screenshot({ path: join(evidence, "4-peer-emoji.png") });

  // An older BlueBubbles reports no emoji capability: the button stays, and a press repeats why instead of opening.
  expect((await desk.request.post("/__fixture/emoji-reactions", { data: { enabled: false } })).ok()).toBe(true);
  await page.waitForTimeout(1000);
  await bubble.click({ button: "right" });
  await tray.getByRole("button", { name: "More reactions" }).click();
  await expect(page.getByText("The Mac's BlueBubbles can't send emoji reactions yet")).toBeVisible();
  await expect(picker).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "5-greyed.png") });
  await page.keyboard.press("Escape");
  writeFileSync(join(evidence, "aria.txt"), await thread.ariaSnapshot());

  expect(enqueued).toEqual([
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "emoji:🔥", remove: false }),
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "emoji:🫶🏽", remove: false }),
    expect.objectContaining({ kind: "react", messageGuid: "needs-2", reaction: "emoji:🫶🏽", remove: true }),
  ]);
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ enqueued, stored }, null, 2));
});

test("emoji-reactions: on a phone, the touch tray's picker sends an emoji", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });
  const bubble = page.getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
  await bubble.hover();
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.up();
  await page.getByRole("toolbar", { name: "Tapbacks" }).getByRole("button", { name: "More reactions" }).click();
  const picker = page.getByRole("dialog", { name: "Emoji reactions" });
  await expect(picker).toBeVisible();
  await page.screenshot({ path: join(evidence, "6-phone-picker.png") });
  await picker.getByRole("button", { name: "😂", exact: true }).click();
  await expect(page.getByRole("button", { name: "😂", exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "7-phone-sent.png") });
});
