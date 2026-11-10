import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

async function helpChord(page: Page, view: string): Promise<string | null> {
  await page.keyboard.press("Meta+/");
  const row = page.getByText(`Go to ${view}`, { exact: true }).locator("..");
  const chord = await row.innerText();
  await page.keyboard.press("Escape");
  return chord.replace(`Go to ${view}`, "").trim();
}

test("navigation: the view's name is a menu of every view, ⌘N follows its order, and help says the same", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "View, Today" })).toBeVisible();

  await page.keyboard.press("Meta+5");
  await expect(heading(page, "Snoozed")).toBeAttached();
  await expect(page.getByText(/^Nothing snoozed/)).toBeVisible();
  expect(await helpChord(page, "Snoozed")).toBe("⌘5");

  await page.keyboard.press("Meta+2");
  await expect(heading(page, "To review")).toBeAttached();
  await page.getByRole("button", { name: "View, To review" }).click();
  await expect(page.getByRole("option")).toHaveCount(9);
  await page.getByRole("option", { name: /Waiting/ }).click();
  await expect(heading(page, "Waiting")).toBeAttached();
});

test("navigation: on the phone the view menu sits above the conversations", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.getByRole("button", { name: /^View, / }).click();
  await page.getByRole("option", { name: /To review/ }).click();
  await expect(heading(page, "To review")).toBeVisible();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
});
