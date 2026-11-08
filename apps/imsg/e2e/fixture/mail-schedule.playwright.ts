import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-mail-schedule-"));
const THREAD = "Sam Lee, Load-in for Saturday";

type Call = { name: string; args: Record<string, unknown> };

test.beforeEach(async ({ desk }) => {
  await desk.page.setViewportSize({ width: 1440, height: 900 });
  await desk.page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});

function convexCalls(page: import("@playwright/test").Page): Call[] {
  const calls: Call[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/__fixture/convex")) calls.push(request.postDataJSON() as Call);
  });
  return calls;
}

async function scheduleReply(page: import("@playwright/test").Page, text: string, screenshot?: string) {
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: THREAD }).click();
  const reader = page.getByTestId("email-reader");
  await reader.getByRole("button", { name: "Reply", exact: true }).click();
  const composer = page.getByTestId("email-composer");
  const later = composer.getByRole("button", { name: "Send later" });
  await expect(later).toBeDisabled();
  await composer.getByLabel("Message").fill(text);
  await later.click();
  await expect(page.getByRole("menuitem", { name: "In 1 hour" })).toBeVisible();
  if (screenshot) await page.screenshot({ path: join(evidence, screenshot) });
  await page.getByRole("menuitem", { name: "In 1 hour" }).click();
  await expect(composer).toHaveCount(0);
  await expect(page.getByText("Email scheduled")).toBeVisible();
  return reader;
}

test("mail-schedule: Send later on a reply schedules it in Convex; the Scheduled screen lists it beside iMessage's, edits and cancels it", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  const reader = await scheduleReply(page, "Confirming 6 pm load-in.", "1-email-send-later.png");
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  expect(calls.filter((call) => call.name === "comma/outbox:enqueue" && (call.args.payload as { kind: string }).kind === "send")).toEqual([]);
  expect(calls.find((call) => call.name === "comma/scheduledSends:schedule")?.args).toMatchObject({
    payload: { kind: "send", text: "Confirming 6 pm load-in.", email: { to: ["Sam Lee <sam@venue.test>"], cc: [], subject: "Re: Load-in for Saturday" } },
  });

  await page.getByRole("button", { name: "Scheduled, 2 pending" }).click();
  const email = page.getByText("Confirming 6 pm load-in.", { exact: true });
  await expect(email).toBeVisible();
  await expect(page.getByText("Checking back tomorrow morning.", { exact: true })).toBeVisible();
  await expect(page.getByText("Gmail, Re: Load-in for Saturday")).toBeVisible();
  await page.screenshot({ path: join(evidence, "2-scheduled-both-kinds.png") });

  await email.hover();
  await page.getByRole("button", { name: "Edit scheduled message to Sam Lee" }).click();
  const time = page.getByPlaceholder("HH:MM");
  await time.fill("23:45");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByPlaceholder("HH:MM")).toHaveCount(0);
  const edit = calls.find((call) => call.name === "comma/scheduledSends:edit")!;
  expect(new Date(Number(edit.args.sendAt)).getHours()).toBe(23);
  await expect(page.getByText("11:45 PM")).toBeVisible();

  await email.hover();
  await page.getByRole("button", { name: "Cancel scheduled message to Sam Lee" }).click();
  await expect(email).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scheduled, 1 pending" })).toBeVisible();
  await expect(page.getByText("Checking back tomorrow morning.", { exact: true })).toBeVisible();
});

test("mail-schedule: Send now sends a scheduled email into its thread as an ordinary send", async ({ desk }) => {
  const page = desk.page;
  await scheduleReply(page, "Sending this one now.");
  await page.getByRole("button", { name: "Scheduled, 2 pending" }).click();
  await page.getByText("Sending this one now.", { exact: true }).hover();
  await page.getByRole("button", { name: "Send scheduled message to Sam Lee now" }).click();
  await expect(page.getByText("Sent now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Scheduled, 1 pending" })).toBeVisible();

  // A reply leaves the thread waiting on Sam, so People no longer lists it.
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All inbox, 3" }).click();
  await page.getByRole("button", { name: THREAD }).click();
  const cards = page.getByTestId("email-reader").getByTestId("email-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.last()).toContainText("Sending this one now.");
});

test("mail-schedule: Send later in a Slack DM schedules it in Convex, not BlueBubbles, and lists it as Slack's", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  await desk.request.post("/__fixture/slack", { data: { seed: true } });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Are we still on for the load-in at 4?" }).click();
  await page.getByPlaceholder("Message Sam Lee").fill("Load-in moved to 5");
  await page.getByRole("button", { name: "Send later" }).click();
  await page.getByRole("menuitem", { name: "In 1 hour" }).click();
  await expect(page.getByRole("button", { name: "Scheduled, 2 pending" })).toBeVisible();
  expect(calls.find((call) => call.name === "comma/scheduledSends:schedule")?.args).toMatchObject({ payload: { kind: "send", text: "Load-in moved to 5" } });
  expect(calls.some((call) => call.name === "comma/outbox:enqueue" && (call.args.payload as { kind: string }).kind === "schedule")).toBe(false);
  await page.getByRole("button", { name: "Scheduled, 2 pending" }).click();
  await expect(page.getByText("Load-in moved to 5", { exact: true })).toBeVisible();
  await expect(page.getByTestId("desktop-utility-pane-content").getByText("Slack", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, "3-scheduled-slack.png") });
});
