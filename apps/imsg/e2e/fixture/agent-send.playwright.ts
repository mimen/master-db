import type { Page } from "@playwright/test";
import { expect, openView, test } from "../fixtures/desk";
import { SEND_TEXT } from "./agent";

/** The Approve and Reject taps the client posts. */
function watchDecisions(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname !== "/__fixture/convex") return;
    const body = req.postDataJSON() as { name: string; args: { approve?: boolean } };
    if (body.name === "comma/agent:decideSend") sent.push(body.args.approve ? "approve" : "reject");
  });
  return sent;
}

async function askToSend(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openView(page, "All");
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();
  await page.keyboard.press("Meta+j");
  const input = page.getByTestId("agent-pane").getByPlaceholder("Ask about this conversation…");
  await input.fill("send him that I'm on my way");
  await input.press("Enter");
  const card = page.getByTestId("agent-send-request");
  await expect(card).toContainText("Send to Alex Rivera?");
  await expect(card).toContainText(SEND_TEXT);
  return card;
}


test("an agent send waits for Approve: nothing reaches the thread until the tap, then the exact text sends", async ({ desk }) => {
  const page = desk.page;
  const decisions = watchDecisions(page);
  const card = await askToSend(page);
  const thread = page.getByTestId("thread-view");
  // The turn has ended and the request is still only a card.
  await expect(page.getByTestId("agent-pane").getByText("It's waiting for your approval above.")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(thread.getByText(SEND_TEXT, { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toContainText("Approved · sending");
  await expect(thread.getByText(SEND_TEXT, { exact: true })).toHaveCount(1);
  expect(decisions).toEqual(["approve"]);
});

test("Reject never sends", async ({ desk }) => {
  const page = desk.page;
  const card = await askToSend(page);
  await card.getByRole("button", { name: "Reject" }).click();
  await expect(card).toContainText("Rejected · not sent");
  await page.waitForTimeout(800);
  await expect(page.getByTestId("thread-view").getByText(SEND_TEXT, { exact: true })).toHaveCount(0);
});
