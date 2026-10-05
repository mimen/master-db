import { expect, test } from "../fixtures/desk";

test("Send later menu opens above its toolbar control and the date editor above the send button", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?schedule", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
  await page.getByTestId("conversation-row").first().click();
  await page.getByPlaceholder("iMessage").fill("Doors at 8");
  const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;

  const later = page.getByRole("button", { name: "Send later" });
  const laterBox = (await later.boundingBox())!;
  await later.click();
  const menuItem = page.getByText("Choose Date & Time…", { exact: true });
  await expect(menuItem).toBeVisible();
  const menu = menuItem.locator("xpath=../..");
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x - laterBox.x), "menu left edge on Send later").toBeLessThanOrEqual(16);
  expect(menuBox.y + menuBox.height, "menu above Send later").toBeLessThanOrEqual(laterBox.y);

  await menuItem.click();
  const title = page.getByText("Choose Date & Time", { exact: true });
  await expect(title).toBeVisible();
  const editor = page.getByRole("button", { name: "Save schedule" }).locator("xpath=../..");
  // The editor springs in; measure where it settles.
  await expect.poll(async () => {
    const box = (await editor.boundingBox())!;
    return Math.abs(box.x + box.width - (send.x + send.width));
  }, { message: "editor right edge on the send button" }).toBeLessThanOrEqual(2);
  const card = (await editor.boundingBox())!;
  expect(card.y + card.height, "editor above the send button").toBeLessThanOrEqual(send.y);
  expect(send.y - (card.y + card.height), "editor sits right on the send button").toBeLessThanOrEqual(16);
  await page.screenshot({ path: "/tmp/comma-ui-batch-e/after/schedule-anchored-desk.png", animations: "disabled" });
});
