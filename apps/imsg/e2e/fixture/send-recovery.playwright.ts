import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-send-recovery-"));
const FAILED_TOAST = "Couldn't send. Check the Mac mini connection.";

type Payload = { kind: string; text?: string; caption?: string; filename?: string; replyToGuid?: string };

function enqueued(page: Page): Payload[] {
  const payloads: Payload[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: Payload } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload) payloads.push(body.args.payload);
  });
  return payloads;
}

async function openAlex(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^All/ }).click();
  await alexRow(page).click();
  const thread = page.getByTestId("thread-view");
  await expect(thread).toBeVisible();
  return thread;
}

const alexRow = (page: Page) => page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" });

async function drop(target: Locator, names: string[]): Promise<void> {
  await target.evaluate((node, files) => {
    const transfer = new DataTransfer();
    for (const name of files) transfer.items.add(new File([name], name, { type: "text/plain" }));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, names);
}

test("send-recovery: a failed send toasts with Retry and Open after the user has left, marks its row, and Discard takes it off", async ({ desk }) => {
  const page = desk.page;
  await openAlex(page);
  await desk.request.post("/__fixture/fault", { data: { method: "sendText", error: "offline" } });
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("this one should fail");
  await composer.press("Enter");
  await page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" }).click();

  const toast = page.getByRole("status").filter({ hasText: FAILED_TOAST });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(alexRow(page).getByTestId("row-send-failed")).toBeVisible();
  await expect(alexRow(page)).toHaveAttribute("aria-label", /not delivered/);
  await page.screenshot({ path: join(evidence, "1-failed-toast-and-row.png") });

  await toast.getByRole("button", { name: "Open" }).click();
  const thread = page.getByTestId("thread-view");
  await expect(thread.getByText("Not delivered", { exact: true })).toBeVisible();
  await thread.getByText("this one should fail", { exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Discard" }).click();
  await expect(thread.getByText("this one should fail", { exact: true })).toHaveCount(0);
  await expect(alexRow(page).getByTestId("row-send-failed")).toHaveCount(0);
  await desk.request.post("/__fixture/fault", { data: { method: null } });
});

test("send-recovery: Retry on the failure toast sends it again and clears the row's mark", async ({ desk }) => {
  const page = desk.page;
  const thread = await openAlex(page);
  await desk.request.post("/__fixture/fault", { data: { method: "sendText", error: "offline" } });
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("second time lucky");
  await composer.press("Enter");
  const toast = page.getByRole("status").filter({ hasText: FAILED_TOAST });
  await expect(toast).toBeVisible();
  await desk.request.post("/__fixture/fault", { data: { method: null } });
  await toast.getByRole("button", { name: "Retry" }).click();
  await expect(thread.getByText("second time lucky", { exact: true })).toHaveCount(1);
  await expect(thread.getByText("Not delivered", { exact: true })).toHaveCount(0);
  await expect(alexRow(page).getByTestId("row-send-failed")).toHaveCount(0);
});

test("send-recovery: a failed attachment send puts back the caption and every file", async ({ desk }) => {
  const page = desk.page;
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    if (body.name !== "comma/outbox:getCommand") return route.continue();
    const response = await route.fetch();
    const receipt = await response.json();
    if (receipt?.result?.kind === "sendAttachment") Object.assign(receipt, { status: "failed", error: "offline", result: undefined });
    await route.fulfill({ response, json: receipt });
  });
  const thread = await openAlex(page);
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("Here are the notes");
  await drop(thread, ["first.txt", "second.txt"]);
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(2);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText(/^Couldn't send the attachment/)).toBeVisible();
  await expect(page.getByPlaceholder("Add a comment or Send")).toHaveValue("Here are the notes");
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(2);
  await page.screenshot({ path: join(evidence, "2-attachment-restaged.png") });
});

test("send-recovery: a reply with a file sends the file, then the text as the reply", async ({ desk }) => {
  const page = desk.page;
  const payloads = enqueued(page);
  const thread = await openAlex(page);
  await thread.getByText("Can you send the final arrival time?", { exact: true }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Reply" }).click();
  await drop(thread, ["arrival.txt"]);
  await page.getByPlaceholder("Add a comment or Send").fill("7:30 at the side door");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(thread.getByText("7:30 at the side door", { exact: true })).toBeVisible();
  await expect.poll(() => payloads.filter((p) => p.kind === "sendAttachment" || p.kind === "send").map((p) => [p.kind, p.caption ?? null, p.text ?? null, p.replyToGuid ?? null]))
    .toEqual([["sendAttachment", null, null, null], ["send", null, "7:30 at the side door", "needs-2"]]);
});

test("send-recovery: Slack turns away dropped files with its reason instead of staging them", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seed: true } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Are we still on for the load-in at 4?" }).click();
  await expect(page.getByPlaceholder("Message Sam Lee")).toBeVisible();
  await drop(page.getByTestId("thread-view"), ["rider.txt"]);
  await expect(page.getByText(/Slack yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(0);
});

test("send-recovery: the alternates stand aside while the field holds text, so a pick never overwrites it", async ({ desk }) => {
  const page = desk.page;
  await openAlex(page);
  const alternates = page.getByTestId("suggestion-alternates");
  await expect(alternates).toContainText("⌥1");
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("my own words");
  await expect(alternates).toHaveCount(0);
  await composer.press("Alt+Digit1");
  await expect(composer).toHaveValue("my own words");
  await composer.fill("");
  await expect(alternates).toContainText("⌥1");
});

test("send-recovery: editing a message borrows the field, and the draft under it comes back", async ({ desk }) => {
  const page = desk.page;
  // The server's clock is pinned to FIXTURE_NOW; the page's matches, so the message is still inside its edit window.
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  const thread = await openAlex(page);
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("see you at load-in");
  await composer.press("Enter");
  await expect(thread.getByText("see you at load-in", { exact: true })).toBeVisible();
  await composer.fill("a half-written thought");
  await thread.getByText("see you at load-in", { exact: true }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByPlaceholder("Edit message")).toHaveValue("see you at load-in");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(composer).toHaveValue("a half-written thought");
});

test.describe("mail", () => {
  test.beforeEach(async ({ desk }) => {
    await desk.page.setViewportSize({ width: 1440, height: 900 });
    await desk.page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await desk.request.post("/__fixture/mail", { data: { mailboxes: true } });
  });

  const chips = (composer: Locator, field: "To" | "Cc") =>
    composer.getByRole("button", { name: new RegExp(` from ${field}$`) }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")!.replace(/^Remove | from (To|Cc)$/g, "")));

  async function openThread(page: Page): Promise<Locator> {
    await page.goto("/mail", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Sam Lee, Load-in for Saturday" }).click();
    const reader = page.getByTestId("email-reader");
    await expect(reader.getByTestId("email-card")).toHaveCount(2);
    return reader;
  }

  test("send-recovery: a refused new email keeps the composer open with what was written and why", async ({ desk }) => {
    const page = desk.page;
    await page.goto("/mail", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New email" }).click();
    const composer = page.getByTestId("email-composer");
    await composer.getByRole("textbox", { name: "To", exact: true }).fill("Jordan Kim <jordan@agency.test>;");
    await composer.getByLabel("Subject").fill("Dinner Friday?");
    await composer.getByLabel("Message").fill("Are you around Friday?");
    await desk.request.post("/__fixture/mail", { data: { refuseNextSend: "Google answered 403: insufficient permissions" } });
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(composer.getByText("Couldn't send: Google answered 403: insufficient permissions")).toBeVisible();
    await expect(composer.getByLabel("Message")).toHaveValue("Are you around Friday?");
    expect(await chips(composer, "To")).toEqual(["Jordan Kim"]);
    await page.screenshot({ path: join(evidence, "3-new-email-refused.png") });

    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(composer).toHaveCount(0);
  });

  test("send-recovery: a refused reply offers Retry, Edit and resend, and Discard", async ({ desk }) => {
    const page = desk.page;
    const reader = await openThread(page);
    const reply = async (text: string) => {
      await desk.request.post("/__fixture/mail", { data: { refuseNextSend: "Google answered 500" } });
      await reader.getByRole("button", { name: "Reply", exact: true }).click();
      await page.getByTestId("email-composer").getByLabel("Message").fill(text);
      await page.getByTestId("email-composer").getByRole("button", { name: "Send", exact: true }).click();
      await expect(reader.getByText("Couldn't send: Google answered 500")).toBeVisible();
    };

    await reply("Retry me");
    await page.screenshot({ path: join(evidence, "4-reply-refused.png") });
    await reader.getByRole("button", { name: "Retry" }).click();
    await expect(reader.getByText("Couldn't send: Google answered 500")).toHaveCount(0);
    await expect(reader.getByTestId("email-card").filter({ hasText: "Retry me" })).toHaveCount(1);

    await reply("Discard me");
    await reader.getByRole("button", { name: "Discard" }).click();
    await expect(reader.getByTestId("email-card").filter({ hasText: "Discard me" })).toHaveCount(0);

    await reply("Edit me");
    await reader.getByRole("button", { name: "Edit and resend" }).click();
    await expect(page.getByTestId("email-composer").getByLabel("Message")).toHaveValue("Edit me");
    await expect(reader.getByTestId("email-card").filter({ hasText: "Edit me" })).toHaveCount(0);
  });

  test("send-recovery: switching Reply and Reply all keeps the chips the user added", async ({ desk }) => {
    const page = desk.page;
    const reader = await openThread(page);
    await reader.getByRole("button", { name: "Reply", exact: true }).click();
    const composer = page.getByTestId("email-composer");
    await composer.getByRole("textbox", { name: "Cc", exact: true }).fill("Pat <pat@agency.test>;");
    await expect.poll(() => chips(composer, "Cc")).toEqual(["Pat"]);
    await composer.getByRole("tab", { name: "Reply all" }).click();
    await expect.poll(() => chips(composer, "Cc")).toEqual(["Dana Ortiz", "Pat"]);
    await composer.getByRole("tab", { name: "Reply", exact: true }).click();
    await expect.poll(() => chips(composer, "Cc")).toEqual(["Pat"]);
    expect(await chips(composer, "To")).toEqual(["Sam Lee"]);
  });
});
