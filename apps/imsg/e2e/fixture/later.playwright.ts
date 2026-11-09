import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

async function needsCount(page: Page): Promise<number> {
  const label = await page.getByRole("tab", { name: /^Needs you, \d+/ }).getAttribute("aria-label");
  return Number(/(\d+)/.exec(label ?? "")?.[1]);
}

const row = (page: Page, name: string) => page.getByTestId("conversation-row").filter({ hasText: name });
const menu = (page: Page) => page.getByRole("dialog");
const palette = (page: Page) => page.getByPlaceholder("Search people and messages, or type a command");

test("Later from a row's menu leaves Needs you, lists under Snoozed, says so in Details, and undoes", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: /^Needs you, \d+/ }).click();
  const before = await needsCount(page);

  await row(page, "Alex Rivera").click({ button: "right" });
  await menu(page).getByText("Later…", { exact: true }).click();
  await menu(page).getByText("Tomorrow 9am", { exact: true }).click();
  await expect(page.getByText(/^Snoozed until Tomorrow, 9:00/)).toBeVisible();
  await expect.poll(() => needsCount(page)).toBe(before - 1);
  await expect(row(page, "Alex Rivera")).toHaveCount(0);

  // ⌘K → Snoozed lists it; opening it shows the snooze in Details.
  await page.keyboard.press("Meta+k");
  await palette(page).fill("Snoozed");
  await page.getByRole("listbox", { name: "Results" }).getByText("Snoozed", { exact: true }).click();
  const results = page.getByRole("listbox", { name: "Results" });
  await expect(results.getByText("Alex Rivera")).toBeVisible();
  await results.getByText("Alex Rivera").click();
  await page.keyboard.press("Meta+i");
  await expect(page.getByTestId("details-later")).toContainText(/Snoozed until Tomorrow, 9:00/);

  // ⌘⇧Z works from anywhere and takes the snooze back.
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => needsCount(page)).toBe(before);
  await expect(page.getByTestId("details-later")).not.toContainText("Snoozed");
});

test("H opens Later outside a text field; Follow up waits on the user's own last message", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "All", exact: true }).click();

  // Alex wrote last, so Follow up has nothing to wait on.
  await row(page, "Alex Rivera").click({ button: "right" });
  await expect(menu(page).getByText("Later…", { exact: true })).toBeVisible();
  await expect(menu(page).getByText("Follow up…", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Jordan's last message is the user's.
  await row(page, "Jordan Lee").click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("h");
  await expect(menu(page).getByText("Next week", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+k");
  await palette(page).fill("Follow up");
  await page.getByRole("listbox", { name: "Results" }).getByText("Follow up if no reply…", { exact: true }).click();
  await menu(page).getByText("In 2 days", { exact: true }).click();
  await expect(page.getByText(/^Follow up .* if no reply$/).first()).toBeVisible();
  await page.keyboard.press("Meta+i");
  await expect(page.getByTestId("details-later")).toContainText(/Follow up .* if no reply/);
  // Following up keeps the conversation where it was: Waiting.
  await expect(row(page, "Jordan Lee")).toHaveCount(1);
});
