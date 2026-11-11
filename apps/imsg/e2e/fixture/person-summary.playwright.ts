import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, unfoldToday } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-person-summary-"));
const SLACK_INBOUND = "Are we still on for the load-in at 4?";
const EMAIL_INBOUND = "Load-in is at 6 pm";

test("Today mixes iMessage, Slack and a People email; the agent pane heads Sam Lee's chat with his summary and open threads on each platform", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seed: true } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await unfoldToday(page);

  const rows = page.getByTestId("conversation-row");
  await expect(rows.filter({ hasText: SLACK_INBOUND })).toHaveCount(1);
  await expect(rows.filter({ hasText: EMAIL_INBOUND })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Alex Rivera" })).toHaveCount(1);
  await page.getByTestId("today-update").click();
  await expect(page.getByTestId("today-update")).toHaveText("Update", { timeout: 10_000 });
  for (const text of [SLACK_INBOUND, EMAIL_INBOUND, "Alex Rivera"]) await expect(rows.filter({ hasText: text }).getByTestId("today-rank")).toHaveText(/^\d+$/);
  await page.screenshot({ path: join(evidence, "today-mixed-platforms.png") });

  await rows.filter({ hasText: SLACK_INBOUND }).click();
  await page.getByPlaceholder("Message Sam Lee").click();
  await page.keyboard.press("Meta+j");
  const header = page.getByTestId("agent-pane").getByTestId("person-summary");
  await expect(header).toContainText("Sam Lee");
  await expect(header).toContainText("Slack, Gmail");
  await expect(header).toContainText("Runs production at the venue.");
  const threads = header.getByTestId("person-thread");
  await expect(threads).toHaveText(["This threadopen here", "Sam Lee · Gmailyour turn"]);
  await page.screenshot({ path: join(evidence, "agent-pane-person-summary.png") });

  await threads.filter({ hasText: "Gmail" }).click();
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();
});
