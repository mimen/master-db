import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";
import { FIXTURE_NOW } from "./world";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-golden-"));

type Desk = Parameters<Parameters<typeof test>[1]>[0]["desk"];

function recordCommands(page: Page): Array<{ kind: string }> {
  const commands: Array<{ kind: string }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload) commands.push(body.args.payload);
  });
  return commands;
}

/** Opens a conversation and sends one line through the composer, so the newest bubble is mine and fresh. */
async function sendIn(desk: Desk, name: string, placeholder: string, text: string) {
  const page = desk.page;
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByLabel("Search conversations and messages").fill(name);
  await page.getByTestId("conversation-row").filter({ hasText: name }).first().click();
  const composer = page.getByPlaceholder(placeholder);
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.getByText("Sent", { exact: true })).toBeVisible({ timeout: 5000 });
  return page.getByTestId("message-bubble").filter({ hasText: text });
}

async function storedReactions(desk: Desk, chatGuid: string, text: string): Promise<string[]> {
  const response = await desk.request.post("/__fixture/convex", {
    data: { name: "comma/queries:listMessages", args: { conversationId: fixtureConversationId(chatGuid), paginationOpts: { numItems: 50, cursor: null } } },
  });
  const { page: rows } = await response.json() as { page: Array<{ text: string; reactions: Array<{ type: string; isFromMe: boolean }> }> };
  return rows.find((row) => row.text === text)?.reactions.filter((r) => r.isFromMe).map((r) => r.type) ?? [];
}

test("platform-profile: an SMS thread greys reactions, reply, edit and unsend with the reason, and Convex refuses them", async ({ desk }) => {
  const page = desk.page;
  const commands = recordCommands(page);
  const text = "SMS profile probe";
  const bubble = await sendIn(desk, "Sam Chen", "Text Message", text);
  await page.screenshot({ path: join(evidence, "sms-1-sent.png") });

  await bubble.click({ button: "right" });
  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  await expect(tray).toHaveAttribute("aria-disabled", "true");
  await expect(tray.getByText("SMS can't send reactions")).toBeVisible();
  const menu = page.getByRole("menu");
  for (const [label, reason] of [
    ["Reply", "SMS can't reply to a message"],
    ["Edit", "SMS can't edit messages"],
    ["Undo send", "SMS can't unsend messages"],
  ] as const) {
    await expect(menu.getByRole("menuitem", { name: label })).toBeDisabled();
    await expect(menu.getByText(reason, { exact: true })).toBeVisible();
  }
  await expect(menu.getByRole("menuitem", { name: "Delete for Me" })).toBeEnabled();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(evidence, "sms-2-menu.png") });
  writeFileSync(join(evidence, "sms-aria.txt"), `${await tray.ariaSnapshot()}\n${await menu.ariaSnapshot()}`);

  // The tray's keyboard pick is the reaction shortcut: it does nothing but repeat the reason.
  await page.keyboard.press("Enter");
  await expect(page.getByText("SMS can't send reactions").last()).toBeVisible();
  await expect(tray).toBeVisible();
  await page.screenshot({ path: join(evidence, "sms-3-keyboard-pick.png") });
  await page.keyboard.press("Escape");

  const rejected = await desk.request.post("/__fixture/convex", {
    data: { name: "comma/outbox:enqueue", args: { conversationId: fixtureConversationId(desk.chats.coldSms), clientKey: "profile-sms-react",
      payload: { kind: "react", messageGuid: "cold-sms-1", reaction: "love", remove: false } } },
  });
  const rejection = { status: rejected.status(), body: await rejected.json() as unknown };
  writeFileSync(join(evidence, "sms-side-effects.json"), JSON.stringify({ commands, rejection }, null, 2));
  expect(commands.map((c) => c.kind).filter((kind) => kind !== "markRead" && kind !== "typing")).toEqual(["send"]);
  expect(commands.some((c) => c.kind === "typing")).toBe(false);
  expect(rejection).toEqual({ status: 400, body: expect.objectContaining({ error: "SMS can't send reactions" }) });
});

test("platform-profile: an iMessage thread keeps every control live and its tapback lands", async ({ desk }) => {
  const page = desk.page;
  const commands = recordCommands(page);
  const text = "iMessage profile probe";
  const bubble = await sendIn(desk, "Alex Rivera", "iMessage", text);

  await bubble.click({ button: "right" });
  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  await expect(tray).not.toHaveAttribute("aria-disabled", "true");
  const menu = page.getByRole("menu");
  for (const label of ["Reply", "Edit", "Undo send", "Delete for Me"]) await expect(menu.getByRole("menuitem", { name: label })).toBeEnabled();
  await expect(menu.getByText("15 min left")).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(evidence, "imessage-1-menu.png") });
  writeFileSync(join(evidence, "imessage-aria.txt"), `${await tray.ariaSnapshot()}\n${await menu.ariaSnapshot()}`);

  await tray.getByRole("button", { name: "Love" }).click();
  await expect.poll(() => storedReactions(desk, desk.chats.needs, text)).toEqual(["love"]);
  await page.screenshot({ path: join(evidence, "imessage-2-reacted.png") });
  writeFileSync(join(evidence, "imessage-side-effects.json"), JSON.stringify({ commands, stored: await storedReactions(desk, desk.chats.needs, text) }, null, 2));
  expect(commands).toContainEqual(expect.objectContaining({ kind: "react", reaction: "love", remove: false }));
  expect(commands.some((c) => c.kind === "typing")).toBe(true);
});
