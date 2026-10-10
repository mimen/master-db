import { expect, test } from "../fixtures/desk";

/**
 * Hill-climb ratchets (docs/hillclimb/README.md). Each test pins a kept performance win,
 * so a change that gives it back fails CI.
 */

test("Contacts and its people list wait for the first visit, then stay mounted", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await expect(page.getByTestId("contacts-desk-header")).toHaveCount(0);

  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByTestId("contacts-desk-header")).toBeVisible();
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect(page.getByTestId("contacts-desk-header")).toHaveCount(1);
});
