import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

/** The views a control offers, by accessible name without the count: a rolling count's text is every digit. */
const names = (items: Locator) => items.evaluateAll((elements) => elements.map((element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/, \d+$/, "")));

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

async function pickNavigation(page: Page, style: "Sidebar list" | "Tabs" | "Compact"): Promise<void> {
  // The footer's Settings toggles its pane, so it is pressed only while the pane is closed.
  const field = page.getByRole("button", { name: /^Navigation, / });
  if (!(await field.isVisible())) await page.getByRole("button", { name: "Settings", exact: true }).click();
  await field.click();
  await page.getByRole("option", { name: new RegExp(`^${style}`) }).click();
  await expect(page.getByRole("button", { name: `Navigation, ${style}` })).toBeVisible();
}

async function helpChord(page: Page, view: string): Promise<string | null> {
  await page.keyboard.press("Meta+/");
  const row = page.getByText(`Go to ${view}`, { exact: true }).locator("..");
  const chord = await row.innerText();
  await page.keyboard.press("Escape");
  return chord.replace(`Go to ${view}`, "").trim();
}

test("navigation: each style lists every view, ⌘N follows its order, and help says the same", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // Sidebar list, the default: every view is a row, Snoozed among them, with counts beside their own names.
  const views = page.getByRole("tablist").filter({ has: page.getByRole("tab", { name: /^Snoozed/ }) });
  expect(await names(views.getByRole("tab"))).toEqual(["Today", "To review", "Waiting", "Unread", "Snoozed", "Drafts", "Agents", "All", "Settled"]);
  await expect(page.getByRole("tab", { name: /^To review, \d+$/ })).toBeVisible();
  await page.keyboard.press("Meta+5");
  await expect(heading(page, "Snoozed")).toBeAttached();
  await expect(page.getByText(/^Nothing snoozed/)).toBeVisible();
  expect(await helpChord(page, "Snoozed")).toBe("⌘5");

  // Tabs: four tabs, the rest under More, and ⌘5 is now Unread, the first view under More.
  await pickNavigation(page, "Tabs");
  await expect(page.getByRole("tab")).toHaveCount(4);
  expect(await names(page.getByRole("tab"))).toEqual(["Today", "To review", "Waiting", "All"]);
  await page.keyboard.press("Meta+5");
  await expect(heading(page, "Unread")).toBeAttached();
  await expect(page.getByRole("button", { name: "More views, Unread" })).toBeVisible();
  await page.getByRole("button", { name: "More views, Unread" }).click();
  // An option's text starts with its glyph's icon-font character.
  await expect(page.getByRole("option")).toHaveText([/Unread\d+$/, /Snoozed\d+$/, /Drafts\d+$/, /Agents\d+$/, /Settled$/]);
  await page.getByRole("option", { name: /Snoozed/ }).click();
  await expect(heading(page, "Snoozed")).toBeAttached();
  expect(await helpChord(page, "Snoozed")).toBe("⌘6");
  expect(await helpChord(page, "All")).toBe("⌘4");

  // Compact: the view's name is the menu, and the menu holds every view in list order.
  await pickNavigation(page, "Compact");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.keyboard.press("Meta+2");
  await expect(heading(page, "To review")).toBeAttached();
  await page.getByRole("button", { name: "View, To review" }).click();
  await expect(page.getByRole("option")).toHaveCount(9);
  await page.getByRole("option", { name: /Waiting/ }).click();
  await expect(heading(page, "Waiting")).toBeAttached();

  // The choice survives a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: /^View, / })).toBeVisible();
});

test("navigation: the phone's Sidebar list is a screen of views, and picking one opens its conversations", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Views", exact: true }).click();
  await expect(heading(page, "Views")).toBeVisible();
  await expect(page.getByTestId("conversation-row")).toHaveCount(0);
  await page.getByRole("tab", { name: /^To review/ }).click();
  await expect(heading(page, "To review")).toBeVisible();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
});
