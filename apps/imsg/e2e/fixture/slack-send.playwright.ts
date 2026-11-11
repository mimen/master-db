import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, unfoldToday } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-slack-"));
const INBOUND = "Are we still on for the load-in at 4?";

type Row = { guid: string; text: string; isFromMe: boolean; edited: boolean; retracted: boolean; clientKey?: string; reactions: Array<{ key: string; isFromMe: boolean }> };

test("slack-send: send, react many, edit and delete in a Slack DM; a lost answer ends unknown and lands once the check finds it", async ({ desk }) => {
  const page = desk.page;
  const sends: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string; text?: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "send") sends.push(body.args.payload.text ?? "");
  });
  const { conversationId } = await (await desk.request.post("/__fixture/slack", { data: { seed: true } })).json() as { conversationId: string };
  const rows = async () => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId, paginationOpts: { numItems: 50, cursor: null } } },
    });
    return (await response.json() as { page: Row[] }).page;
  };
  const row = async (text: string) => (await rows()).find((candidate) => candidate.text === text);

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await unfoldToday(page);
  await page.getByTestId("conversation-row").filter({ hasText: INBOUND }).click();
  const thread = page.getByTestId("thread-view");
  const composer = page.getByPlaceholder("Message Sam Lee");
  await expect(composer).toBeVisible();
  await expect(page.getByTestId("composer-service")).toBeDisabled();
  await expect(page.getByTestId("composer-service")).toHaveAccessibleName("Service: Slack");
  await page.screenshot({ path: join(evidence, "1-slack-composer.png") });

  await composer.fill("On my way <with gear> & cables");
  await composer.press("Enter");
  await expect(thread.getByText("On my way <with gear> & cables", { exact: true })).toHaveCount(1);
  await expect.poll(async () => (await row("On my way <with gear> & cables"))?.guid ?? "").toMatch(/^D1:\d+\.\d+$/);
  await expect.poll(async () => (await rows()).filter((candidate) => candidate.guid.startsWith("temp-")).length).toBe(0);
  await page.screenshot({ path: join(evidence, "2-sent.png") });

  const inbound = thread.getByRole("button", { name: `Sam Lee: ${INBOUND}` });
  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  const mine = async () => ((await row(INBOUND))?.reactions ?? []).filter((r) => r.isFromMe).map((r) => r.key);
  await inbound.click({ button: "right" });
  await tray.getByRole("button", { name: "👍" }).click();
  await expect.poll(mine).toEqual(["emoji:👍"]);
  await inbound.click({ button: "right" });
  await tray.getByRole("button", { name: "🔥" }).click();
  await expect.poll(mine).toEqual(["emoji:👍", "emoji:🔥"]);
  // A 👍 chip reads as the Like tapback it looks like.
  await expect(thread.getByRole("button", { name: "Like", exact: true })).toBeVisible();
  await expect(thread.getByRole("button", { name: "🔥", exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "3-two-reactions.png") });
  await inbound.click({ button: "right" });
  await tray.getByRole("button", { name: "Remove 👍" }).click();
  await expect.poll(mine).toEqual(["emoji:🔥"]);
  await page.screenshot({ path: join(evidence, "4-one-removed.png") });

  const sent = thread.getByTestId("message-bubble").filter({ hasText: "On my way <with gear> & cables" });
  await sent.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Delete for Me" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "Edit" }).click();
  const editor = page.getByPlaceholder("Edit message");
  await expect(editor).toHaveValue("On my way <with gear> & cables");
  await editor.fill("On my way, 10 minutes out");
  await editor.press("Enter");
  await expect.poll(async () => (await row("On my way, 10 minutes out"))?.edited).toBe(true);
  await expect(thread.getByText("On my way, 10 minutes out", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "5-edited.png") });

  await thread.getByTestId("message-bubble").filter({ hasText: "On my way, 10 minutes out" }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await rows()).filter((candidate) => candidate.isFromMe).length).toBe(0);
  await expect(thread.getByText("On my way, 10 minutes out", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "6-deleted.png") });

  await desk.request.post("/__fixture/slack", { data: { loseNextAnswerMs: 2_000 } });
  await composer.fill("Running five late");
  await composer.press("Enter");
  await expect(page.getByText("Not sure this went through. Check the conversation before trying again.")).toBeVisible();
  await expect.poll(async () => (await rows()).find((candidate) => candidate.text === "Running five late")?.guid ?? "").toMatch(/^temp-/);
  await page.screenshot({ path: join(evidence, "7-unknown.png") });
  await expect.poll(async () => (await row("Running five late"))?.guid ?? "", { timeout: 10_000 }).toMatch(/^D1:/);
  await expect(thread.getByText("Running five late", { exact: true })).toHaveCount(1);
  await expect(thread.getByText("Not delivered", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "8-found.png") });

  expect(sends).toEqual(["On my way <with gear> & cables", "Running five late"]);
  writeFileSync(join(evidence, "stored.json"), JSON.stringify(await rows(), null, 2));
});
