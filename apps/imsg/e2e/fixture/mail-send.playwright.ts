import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-mail-send-"));
const THREAD = "Sam Lee, Load-in for Saturday";

type Payload = { kind: string; text?: string; replyToGuid?: string; email?: { to: string[]; cc: string[]; subject: string } };

test.beforeEach(async ({ desk }) => {
  await desk.page.setViewportSize({ width: 1440, height: 900 });
  await desk.page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});

async function openThread(desk: { page: import("@playwright/test").Page }) {
  const page = desk.page;
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: THREAD }).click();
  const reader = page.getByTestId("email-reader");
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  return reader;
}

/** The chips in To or Cc, by the name each reads as. */
const chips = (composer: import("@playwright/test").Locator, field: "To" | "Cc") =>
  composer.getByRole("button", { name: new RegExp(` from ${field}$`) }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")!.replace(/^Remove | from (To|Cc)$/g, "")));

function enqueued(page: import("@playwright/test").Page): Payload[] {
  const payloads: Payload[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: Payload } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload) payloads.push(body.args.payload);
  });
  return payloads;
}

test("mail-send: reply prefills the sender and subject, reply all adds the rest, Enter adds a line and ⌘Enter sends into the thread", async ({ desk }) => {
  const page = desk.page;
  const payloads = enqueued(page);
  const reader = await openThread(desk);

  await reader.getByRole("button", { name: "Reply", exact: true }).click();
  const composer = page.getByTestId("email-composer");
  expect(await chips(composer, "To")).toEqual(["Sam Lee"]);
  expect(await chips(composer, "Cc")).toEqual([]);
  await expect(composer.getByTestId("composer-source")).toContainText("Replying to Sam Lee");
  await expect(composer.getByLabel("Subject")).toHaveValue("Re: Load-in for Saturday");

  const body = composer.getByLabel("Message");
  await body.fill("See you at 6.");
  await body.press("Enter");
  await body.pressSequentially("Bringing the van.");
  await expect(body).toHaveValue("See you at 6.\nBringing the van.");
  await expect(reader.getByTestId("email-card")).toHaveCount(2);

  await composer.getByRole("tab", { name: "Reply all" }).click();
  await expect.poll(() => chips(composer, "Cc")).toEqual(["Dana Ortiz"]);
  expect(await chips(composer, "To")).toEqual(["Sam Lee"]);
  await page.screenshot({ path: join(evidence, "1-composer-reply-all.png") });

  await body.press("Meta+Enter");
  await expect(composer).toHaveCount(0);
  const cards = reader.getByTestId("email-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(2)).toContainText("See you at 6.");
  await expect(cards.nth(2)).toContainText("cc Dana Ortiz");
  await expect(cards.nth(2)).not.toContainText("Sending…");
  expect(payloads.filter((payload) => payload.kind === "send")).toEqual([{
    kind: "send", text: "See you at 6.\nBringing the van.", replyToGuid: "mv2",
    email: { to: ["Sam Lee <sam@venue.test>"], cc: ["Dana Ortiz <dana@venue.test>"], subject: "Re: Load-in for Saturday" },
  }]);
  await page.screenshot({ path: join(evidence, "2-threaded-reply.png") });
});

test("mail-send: a send whose answer is lost says so and lands once when the check finds it", async ({ desk }) => {
  const page = desk.page;
  const payloads = enqueued(page);
  const reader = await openThread(desk);
  await desk.request.post("/__fixture/mail", { data: { loseNextAnswerMs: 2_000 } });
  await reader.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByTestId("email-composer").getByLabel("Message").fill("Confirmed.");
  await page.getByTestId("email-composer").getByRole("button", { name: "Send", exact: true }).click();
  await expect(reader.getByText("Not sure this went through. Check Sent in Gmail before sending again.")).toBeVisible();
  await page.screenshot({ path: join(evidence, "3-unknown-send.png") });
  await expect(reader.getByText("Not sure this went through.", { exact: false })).toHaveCount(0, { timeout: 10_000 });
  await expect(reader.getByTestId("email-card").filter({ hasText: "Confirmed." })).toHaveCount(1);
  expect(payloads.filter((payload) => payload.kind === "send")).toHaveLength(1);
});

test("mail-send: Archive settles and leaves the inbox, Move to Inbox brings it back, and a refused archive shows Gmail's error", async ({ desk }) => {
  const page = desk.page;
  const reader = await openThread(desk);
  const list = page.getByTestId("mail-list");
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();

  await reader.getByRole("button", { name: "Archive" }).click();
  await expect(list.getByText("Load-in for Saturday")).toHaveCount(0);
  await expect(reader.getByRole("button", { name: "Move to Inbox" })).toBeVisible();
  await page.screenshot({ path: join(evidence, "4-archived.png") });

  await reader.getByRole("button", { name: "Move to Inbox" }).click();
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();
  await expect(reader.getByRole("button", { name: "Archive" })).toBeVisible();

  await desk.request.post("/__fixture/mail", { data: { refuseNextArchive: "Google answered 403: PERMISSION_DENIED" } });
  await reader.getByRole("button", { name: "Archive" }).click();
  await expect(reader.getByRole("alert")).toHaveText("Gmail didn't archive this: Google answered 403: PERMISSION_DENIED");
  await expect(reader.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();
  await page.screenshot({ path: join(evidence, "5-archive-refused.png") });
});

test("mail-send: an agent's draft opens the email composer with its text and note, and sending takes the draft", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/convex", {
    data: { name: "comma/drafts:prepareDraft", args: { chatGuid: "mail:t-venue", text: "6 works. I'll bring the van.", note: "Sam asked to confirm load-in." } },
  });
  await openThread(desk);
  const composer = page.getByTestId("email-composer");
  await expect(composer.getByLabel("Message")).toHaveValue("6 works. I'll bring the van.");
  await expect(composer.getByText("Sam asked to confirm load-in.")).toBeVisible();
  expect(await chips(composer, "To")).toEqual(["Sam Lee"]);
  await page.screenshot({ path: join(evidence, "6-agent-draft.png") });
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("email-card").filter({ hasText: "6 works. I'll bring the van." })).toHaveCount(1);
  await expect(composer).toHaveCount(0);
  const draft = await desk.request.post("/__fixture/convex", { data: { name: "comma/queries:getDraft", args: { conversationId: "mail:t-venue" } } });
  expect(await draft.json()).toBeNull();
});
