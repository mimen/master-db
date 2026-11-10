import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, openView, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-slack-threads-"));
const MENTION = "@Milad can you sign the rider before then?";
const ROOT = "Load-in moved to 5. Who can confirm the van?";

test("slack-threads desk: the inbox lists only the thread that wants Milad, and it opens in a panel beside #bookings", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seedChannel: true } });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openView(page, "All");

  const rows = page.getByTestId("conversation-row");
  const threadRow = rows.filter({ hasText: MENTION });
  await expect(threadRow).toHaveCount(1);
  await expect(threadRow).toContainText("Thread, 2 replies");
  await expect(rows.filter({ hasText: "Doors at 8" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "thanks!" }), "a thread Milad isn't in stays in its channel").toHaveCount(0);
  await expect(rows.filter({ hasText: "Thanks Dana" }), "a thread Milad answered stays in its channel").toHaveCount(0);
  await page.screenshot({ path: join(evidence, "1-inbox-after.png") });

  await threadRow.click();
  const panel = page.getByTestId("thread-view").nth(1);
  await expect(page.getByTestId("thread-view").first().getByText(ROOT)).toBeVisible();
  await expect(page.getByTestId("thread-view").first().getByRole("button", { name: "Open thread, 2 replies" })).toBeVisible();
  await expect(panel.getByText("I can drive it")).toBeVisible();
  await expect(panel.getByText(MENTION)).toBeVisible();
  await expect(panel.getByText(ROOT), "the panel shows the thread's root first").toBeVisible();
  await expect(panel.getByRole("button", { name: /^Open thread/ }), "the root has no chip to its own thread").toHaveCount(0);
  await page.screenshot({ path: join(evidence, "2-thread-panel-desk.png") });

  const composer = panel.getByPlaceholder("Message #bookings");
  await composer.fill("Signed, it's in the drive");
  await composer.press("Enter");
  await expect(panel.getByText("Signed, it's in the drive")).toBeVisible();
  await expect(page.getByTestId("thread-view").first().getByRole("button", { name: "Open thread, 3 replies" })).toBeVisible();
  await expect(rows.filter({ hasText: MENTION }), "answered, the thread leaves the inbox").toHaveCount(0);

  await page.getByRole("button", { name: "Open thread, 1 reply" }).click();
  await expect(page.getByTestId("thread-view").nth(1).getByText("thanks!")).toBeVisible();
  await page.getByRole("button", { name: "Close thread" }).click();
  await expect(page.getByTestId("thread-view")).toHaveCount(1);
  await expect(page.getByTestId("thread-view").getByText("Doors at 8, set times to follow")).toBeVisible();
});

test("slack-threads phone: a channel's thread chip pushes the thread as its own screen", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await desk.request.post("/__fixture/slack", { data: { seedChannel: true } });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openView(page, "All");
  await page.getByTestId("conversation-row").filter({ hasText: "Doors at 8" }).click();
  await expect(page.getByText(ROOT)).toBeVisible();
  await page.getByRole("button", { name: "Open thread, 2 replies" }).click();
  await expect(page).toHaveURL(/\/c\/fx/);
  const pushed = page.getByTestId("thread-view").last();
  await expect(pushed.getByText("I can drive it")).toBeVisible();
  await expect(pushed.getByText(MENTION)).toBeVisible();
  await expect(pushed.getByText(ROOT)).toBeVisible();
  await expect(pushed.getByPlaceholder("Message #bookings")).toBeVisible();
  await page.screenshot({ path: join(evidence, "3-thread-phone.png") });
});

test("slack-channels: Settings lists Slack channels and follows one", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seedChannel: true } });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByText("AUF. Comma reads your DMs, group DMs, threads and the channels you follow.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Follow #bookings" })).toBeChecked();
  const ops = page.getByRole("switch", { name: "Follow #ops" });
  await expect(ops).not.toBeChecked();
  await expect(page.getByText("Private")).toBeVisible();
  await ops.click();
  await expect(ops).toBeChecked();
  await expect.poll(async () => {
    const response = await desk.request.post("/__fixture/convex", { data: { name: "comma/slackChannels:listSlackChannels", args: { accountId: "account-slack" } } });
    return (await response.json() as Array<{ id: string; following: boolean }>).filter((channel) => channel.following).map((channel) => channel.id);
  }).toEqual(["C1", "C3"]);
  await page.screenshot({ path: join(evidence, "4-channel-opt-ins.png"), animations: "disabled" });
});
