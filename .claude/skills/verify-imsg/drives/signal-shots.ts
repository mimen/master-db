import { join } from "node:path";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;

async function openNeedsThread(page: import("@playwright/test").Page, theme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();
  await expect(page.getByTestId("thread-view")).toBeVisible();
  await page.mouse.move(700, 300);
  await page.waitForTimeout(800);
}

test("signal-shots: desktop light", async ({ desk }) => {
  await desk.page.setViewportSize({ width: 1440, height: 900 });
  await openNeedsThread(desk.page, "light");
  await desk.page.screenshot({ path: join(evidence, "desk-main.png") });
  const rows = desk.page.getByTestId("conversation-row");
  await rows.nth(2).hover();
  await desk.page.waitForTimeout(300);
  await desk.page.screenshot({ path: join(evidence, "desk-hover.png") });
  const brand = desk.page.getByRole("heading", { name: "Comma" });
  expect(await brand.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Bricolage Grotesque");
  expect(await desk.page.evaluate(() => document.fonts.check('16px "Bricolage Grotesque"'))).toBe(true);
  await desk.page.mouse.move(700, 300);
  await desk.page.keyboard.press("Escape");
  await desk.page.keyboard.press("j");
  await desk.page.waitForTimeout(300);
  await desk.page.screenshot({ path: join(evidence, "desk-focus.png") });
  await desk.page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(desk.page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await desk.page.waitForTimeout(500);
  await desk.page.screenshot({ path: join(evidence, "desk-contacts.png") });
});

test("signal-shots: desktop dark", async ({ desk }) => {
  await desk.page.setViewportSize({ width: 1440, height: 900 });
  await openNeedsThread(desk.page, "dark");
  await desk.page.screenshot({ path: join(evidence, "desk-main-dark.png") });
});

test("signal-shots: phone", async ({ desk }) => {
  await desk.page.setViewportSize({ width: 390, height: 844 });
  await desk.page.goto("/");
  await expect(desk.page.getByTestId("conversation-row").first()).toBeVisible();
  await desk.page.waitForTimeout(800);
  await desk.page.screenshot({ path: join(evidence, "phone-list.png") });
  await desk.page.emulateMedia({ colorScheme: "dark" });
  await desk.page.waitForTimeout(400);
  await desk.page.screenshot({ path: join(evidence, "phone-list-dark.png") });
});
