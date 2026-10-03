import { expect, test } from "../fixtures/desk";

test("Send later menu and date editor open above the send button on desktop", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?schedule", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
  await page.getByTestId("conversation-row").first().click();
  await page.getByPlaceholder("iMessage").fill("Doors at 8");
  const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;

  await page.getByRole("button", { name: "Schedule message" }).click();
  const menuItem = page.getByText("Choose Date & Time…", { exact: true });
  await expect(menuItem).toBeVisible();
  const menu = menuItem.locator("xpath=../..");
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x + menuBox.width - (send.x + send.width)), "menu right edge on the send button").toBeLessThanOrEqual(2);
  expect(menuBox.y + menuBox.height, "menu above the send button").toBeLessThanOrEqual(send.y);

  await menuItem.click();
  const title = page.getByText("Choose Date & Time", { exact: true });
  await expect(title).toBeVisible();
  const card = (await page.getByRole("button", { name: "Save schedule" }).locator("xpath=../..").boundingBox())!;
  expect(Math.abs(card.x + card.width - (send.x + send.width)), "editor right edge on the send button").toBeLessThanOrEqual(2);
  expect(card.y + card.height, "editor above the send button").toBeLessThanOrEqual(send.y);
  expect(send.y - (card.y + card.height), "editor sits right on the send button").toBeLessThanOrEqual(16);
  await page.screenshot({ path: "/tmp/comma-ui-batch-e/after/schedule-anchored-desk.png", animations: "disabled" });
});
