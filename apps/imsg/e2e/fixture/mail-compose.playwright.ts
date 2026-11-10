import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-mail-compose-"));
const INVOICE_THREAD = "Rosa Diaz, Invoice #42 for Saturday";

type Payload = {
  kind: string; text?: string; replyToGuid?: string; accountId?: string;
  email?: { to: string[]; cc: string[]; subject: string; attachments?: { storageId: string; filename: string; mimeType: string }[] };
};

test.beforeEach(async ({ desk }) => {
  await desk.page.setViewportSize({ width: 1440, height: 900 });
  await desk.page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  // Both mailboxes connected, so the reader knows Milad's own addresses as Settings would.
  await desk.request.post("/__fixture/mail", { data: { invoice: true, mailboxes: true } });
});

function enqueued(page: Page): { payload: Payload; conversationId?: string }[] {
  const calls: { payload: Payload; conversationId?: string }[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: Payload; conversationId?: string } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload) calls.push({ payload: body.args.payload, ...(body.args.conversationId ? { conversationId: body.args.conversationId } : {}) });
  });
  return calls;
}

const chips = (composer: Locator, field: "To" | "Cc") =>
  composer.getByRole("button", { name: new RegExp(` from ${field}$`) }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")!.replace(/^Remove | from (To|Cc)$/g, "")));
const checked = (composer: Locator) =>
  composer.getByRole("checkbox").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("aria-label"), node.getAttribute("aria-checked")]));

async function openInvoice(page: Page) {
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: INVOICE_THREAD }).click();
  const reader = page.getByTestId("email-reader");
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  return reader;
}

test("mail-files: an email's files show as a tile and a thumbnail, its inline logo draws in the body, and the photo opens in the lightbox", async ({ desk }) => {
  const page = desk.page;
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: /^Rosa Diaz, / }).click();
  const invoice = reader.getByTestId("email-card").first();
  await expect(invoice.getByRole("link", { name: /^invoice-42\.pdf, \d+ KB\. Click to download$/ })).toBeVisible();
  await expect(invoice.getByText("logo.png")).toHaveCount(0);
  const logo = invoice.frameLocator('iframe[title="Email from Rosa Diaz"]').locator('img[alt="Venue logo"]');
  await expect.poll(() => logo.getAttribute("src"), { message: "the cid image draws from its stored bytes as a data: URL" }).toMatch(/^data:image\/png;base64,/);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const stage = reader.getByRole("button", { name: "Open stage.png" });
  await expect.poll(() => stage.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: join(evidence, "1-files-in-reader.png") });
  await stage.click();
  await expect(page.getByRole("button", { name: "Close viewer", exact: true })).toBeVisible();
  await expect(page.getByLabel("Media unavailable")).toHaveCount(0);
});

test("mail-reply-message: Reply on an earlier message answers that message, names it, and threads to it", async ({ desk }) => {
  const page = desk.page;
  const calls = enqueued(page);
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: /^Rosa Diaz, / }).click();
  await reader.getByRole("button", { name: "Reply to the message from Rosa Diaz" }).click();
  const composer = page.getByTestId("email-composer");
  await expect(composer.getByTestId("composer-source")).toContainText("Replying to Rosa Diaz");
  await expect(composer.getByTestId("composer-source")).toContainText("invoice #42 for Saturday is attached");
  expect(await chips(composer, "To")).toEqual(["Rosa Diaz"]);
  expect(await checked(composer), "a plain Reply offers no files").toEqual([]);
  await composer.getByLabel("Message").fill("Paid today. Thanks, Rosa.");
  await page.screenshot({ path: join(evidence, "2-reply-to-message.png") });
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(reader.getByTestId("email-card").filter({ hasText: "Paid today." })).toHaveCount(1);
  expect(calls.map((call) => call.payload)).toEqual([{
    kind: "send", text: "Paid today. Thanks, Rosa.", replyToGuid: "mi1",
    email: { to: ["Rosa Diaz <rosa@venue.test>"], cc: [], subject: "Re: Invoice #42 for Saturday" },
  }]);
});

test("mail-reply-all-files: plain Reply all lists the thread's files unchecked, and one tap carries the invoice to Carlos", async ({ desk }) => {
  const page = desk.page;
  const calls = enqueued(page);
  const reader = await openInvoice(page);
  await expect(reader.getByRole("button", { name: /Reply all with attachments/ })).toHaveCount(0);
  await reader.getByRole("button", { name: "Reply all to the message from Sam Lee" }).click();
  const composer = page.getByTestId("email-composer");
  await expect(composer.getByTestId("composer-source")).toContainText("Replying to Sam Lee");
  expect(await chips(composer, "To")).toEqual(["Sam Lee", "Rosa Diaz"]);
  expect(await chips(composer, "Cc")).toEqual(["Dana Ortiz"]);
  expect(await checked(composer)).toEqual([["Include invoice-42.pdf", "false"], ["Include stage.png", "false"]]);

  // A plain Reply leaves the thread's files out; back to Reply all, they are offered again, still unchecked.
  await composer.getByRole("tab", { name: "Reply", exact: true }).click();
  expect(await checked(composer)).toEqual([]);
  await composer.getByRole("tab", { name: "Reply all" }).click();
  expect(await checked(composer)).toEqual([["Include invoice-42.pdf", "false"], ["Include stage.png", "false"]]);

  await composer.getByRole("textbox", { name: "Cc", exact: true }).fill("Carlos Ruiz <carlos@books.test>,");
  await expect.poll(() => chips(composer, "Cc")).toEqual(["Dana Ortiz", "Carlos Ruiz"]);
  await composer.getByRole("checkbox", { name: "Include invoice-42.pdf" }).click();
  await composer.getByLabel("Message").fill("Looping in Carlos for the books.");
  await page.screenshot({ path: join(evidence, "3-reply-all-with-attachments.png") });
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveCount(0);
  const sent = reader.getByTestId("email-card").filter({ hasText: "Looping in Carlos" });
  await expect(sent.getByRole("link", { name: /^invoice-42\.pdf/ })).toBeVisible();
  expect(calls.map((call) => call.payload)).toEqual([{
    kind: "send", text: "Looping in Carlos for the books.", replyToGuid: "mi2",
    email: {
      to: ["Sam Lee <sam@venue.test>", "Rosa Diaz <rosa@venue.test>"], cc: ["Dana Ortiz <dana@venue.test>", "Carlos Ruiz <carlos@books.test>"],
      subject: "Re: Invoice #42 for Saturday", attachments: [{ storageId: "mail-invoice-42.pdf", filename: "invoice-42.pdf", mimeType: "application/pdf" }],
    },
  }]);
});

test("mail-reply-all-unchecked: a Reply all that checks nothing sends no files", async ({ desk }) => {
  const page = desk.page;
  const calls = enqueued(page);
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: "Reply all to the message from Sam Lee" }).click();
  const composer = page.getByTestId("email-composer");
  await composer.getByLabel("Message").fill("Thanks all.");
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.payload.email?.attachments).toBeUndefined();
});

test("mail-from-chip: a reply shows the mailbox it goes out from, fixed; with one mailbox there is no chip", async ({ desk }) => {
  const page = desk.page;
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: "Reply to the message from Sam Lee" }).click();
  const composer = page.getByTestId("email-composer");
  const from = composer.getByTestId("from-chip");
  await expect(from).toHaveAccessibleName("From AUF, milad@afternoonumbrellafriends.com");
  await expect(composer.getByRole("button", { name: /^From / }), "a reply cannot change its mailbox").toHaveCount(0);

  await desk.request.post("/__fixture/reset");
  await desk.request.post("/__fixture/mail", { data: { invoice: true } });
  const single = await openInvoice(page);
  await single.getByRole("button", { name: "Reply to the message from Sam Lee" }).click();
  await expect(page.getByTestId("email-composer").getByLabel("Message")).toBeFocused();
  await expect(page.getByTestId("email-composer").getByTestId("from-chip")).toHaveCount(0);
});

test("mail-forward: Forward quotes the original under a note, carries its files, and sends as a new thread from the same mailbox", async ({ desk }) => {
  const page = desk.page;
  const calls = enqueued(page);
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: /^Rosa Diaz, / }).click();
  await reader.getByRole("button", { name: "Forward to the message from Rosa Diaz" }).click();
  const composer = page.getByTestId("email-composer");
  await expect(page.getByRole("dialog", { name: "Forward email" })).toBeVisible();
  await expect(composer.getByText("Forward email", { exact: true })).toBeVisible();
  await expect(composer.getByTestId("composer-source")).toContainText("Forwarding Rosa Diaz");
  await expect(composer.getByLabel("Subject")).toHaveValue("Fwd: Invoice #42 for Saturday");
  expect(await chips(composer, "To")).toEqual([]);
  expect(await checked(composer)).toEqual([["Include invoice-42.pdf", "true"]]);
  await composer.getByRole("textbox", { name: "To", exact: true }).fill("carlos@books.test");
  await composer.getByLabel("Message").fill("Carlos, for the books.");
  await page.screenshot({ path: join(evidence, "4-forward-composer.png") });
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(page.getByText("Email sent")).toBeVisible();

  expect(calls).toHaveLength(1);
  expect(calls[0]!.conversationId).toBeUndefined();
  const { payload } = calls[0]!;
  expect(payload).toMatchObject({
    kind: "sendEmail", accountId: "account-gmail",
    email: { to: ["carlos@books.test"], cc: [], subject: "Fwd: Invoice #42 for Saturday",
      attachments: [{ storageId: "mail-invoice-42.pdf", filename: "invoice-42.pdf", mimeType: "application/pdf" }] },
  });
  expect(payload.text).toMatch(/^Carlos, for the books\.\n\n---------- Forwarded message ---------\nFrom: Rosa Diaz <rosa@venue\.test>\nDate: .+\nSubject: Invoice #42 for Saturday\nTo: milad@afternoonumbrellafriends\.com, Sam Lee <sam@venue\.test>\nCc: Dana Ortiz <dana@venue\.test>\n\nHi Milad, invoice #42/);
});

test("mail-compose: New email picks its mailbox, takes chips, and sends a new thread from it", async ({ desk }) => {
  const page = desk.page;
  const calls = enqueued(page);
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New email" }).click();
  const composer = page.getByTestId("email-composer");
  await expect(page.getByRole("dialog", { name: "New email" })).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "To", exact: true })).toBeFocused();
  const from = composer.getByTestId("from-chip");
  await expect(from).toHaveAccessibleName("From AUF, milad@afternoonumbrellafriends.com");
  await from.click();
  await expect(from).toHaveAccessibleName("From Personal, miladmaaan@gmail.com");
  await composer.getByRole("textbox", { name: "To", exact: true }).fill("Jordan Kim <jordan@agency.test>;");
  await expect.poll(() => chips(composer, "To")).toEqual(["Jordan Kim"]);
  await composer.getByLabel("Subject").fill("Dinner Friday?");
  await composer.getByLabel("Message").fill("Are you around Friday?");
  await page.screenshot({ path: join(evidence, "5-compose-from-picker.png") });
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect(calls.map((call) => call.payload)).toEqual([{
    kind: "sendEmail", accountId: "account-gmail-personal", text: "Are you around Friday?",
    email: { to: ["Jordan Kim <jordan@agency.test>"], cc: [], subject: "Dinner Friday?" },
  }]);
});

test("mail-agent: Ask agent opens the agent pane on the open email thread", async ({ desk }) => {
  const page = desk.page;
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: "Ask the agent" }).click();
  const pane = page.getByTestId("agent-pane");
  await expect(pane).toBeVisible();
  await expect(page.getByTestId("desktop-shell")).toHaveAttribute("data-utility-workspace", "mail");
  await expect(page.getByRole("textbox", { name: "Ask the agent" })).toBeVisible();
  await page.screenshot({ path: join(evidence, "6-agent-on-email.png") });
});

test("mail-reply-esc: the docked reply closes on Esc while empty and asks before discarding what was written", async ({ desk }) => {
  const page = desk.page;
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: "Reply to the message from Sam Lee" }).click();
  const composer = page.getByTestId("email-composer");
  await expect(composer.getByLabel("Message", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  await reader.getByRole("button", { name: "Reply to the message from Sam Lee" }).click();
  await composer.getByLabel("Message", { exact: true }).fill("Half a thought");
  await page.keyboard.press("Escape");
  await expect(composer.getByRole("alert")).toHaveText("Discard what you wrote?");
  await composer.getByRole("button", { name: "Keep editing" }).click();
  await expect(composer.getByLabel("Message", { exact: true })).toHaveValue("Half a thought");
  await composer.getByRole("button", { name: "Close Reply" }).click();
  await composer.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
});
