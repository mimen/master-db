import { expect, settledCount, test } from "../fixtures/desk";

const rowNames = (page: import("@playwright/test").Page) =>
  page.getByTestId("conversation-row").evaluateAll((rows) => rows.map((row) => (row.getAttribute("aria-label") ?? "").split(",")[0]));

test("⌘↓ and ⌘↑ step conversations from the composer without settling", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/");
  const rows = page.getByTestId("conversation-row");
  await settledCount(rows);
  await rows.first().click();
  const composer = page.getByPlaceholder(/iMessage|Text Message/);
  await expect(composer).toBeFocused();
  const count = await rows.count();
  const names = await rowNames(page);
  const selected = () => page.locator('[data-testid="conversation-row"][aria-selected="true"]').evaluate((row) => (row.getAttribute("aria-label") ?? "").split(",")[0]);

  await page.keyboard.press("Meta+ArrowDown");
  await expect.poll(selected).toBe(names[1]);
  await page.keyboard.press("Meta+ArrowUp");
  await expect.poll(selected).toBe(names[0]);
  expect(await rows.count()).toBe(count);
});

test("Sort: Oldest first reverses the list and shows a chip that flips it back", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/");
  await page.getByRole("tab", { name: /^Needs you/ }).click();
  await settledCount(page.getByTestId("conversation-row"));
  const newest = await rowNames(page);
  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  await page.getByRole("button", { name: "Sort, Newest first" }).click();
  await page.getByRole("option", { name: "Oldest first" }).click();
  await page.getByRole("button", { name: "Close filters" }).click({ position: { x: 5, y: 5 } });
  // Pinned and high-priority rows stay on top of their age group; everything else flips.
  await expect.poll(async () => (await rowNames(page)).at(-1)).not.toBe(newest.at(-1));
  expect((await rowNames(page)).toSorted()).toEqual(newest.toSorted());
  await page.getByRole("button", { name: "Remove filter Oldest first" }).click();
  await expect.poll(() => rowNames(page)).toEqual(newest);
});
