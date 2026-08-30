import type { Locator, Page } from "@playwright/test";
import { expect, test, type SidebarHarness } from "./fixtures/sidebar";

const playwrightTest = "Bun" in globalThis ? undefined : test;
const COMMAND_BEARING_QUERY = "jkeucz";
const QUERY_RESET_TEXT = "q";

interface ButtonAppearance {
  readonly backgroundColor: string;
  readonly textColor: string;
}

interface ScrollGeometry {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}

function lensButton(page: Page, label: "Needs" | "Waiting" | "All"): Locator {
  const accessibleLabel = label === "Needs" ? "Needs reply" : label === "All" ? "All messages" : "Waiting";
  return page.getByRole("button", {
    name: new RegExp(`^${accessibleLabel}, \\d+ conversations$`),
  });
}

async function buttonAppearance(button: Locator): Promise<ButtonAppearance> {
  return button.evaluate((element): ButtonAppearance => {
    const textElement = [...element.children].find((child) => child.tagName === "DIV") ?? element;
    return {
      backgroundColor: globalThis.getComputedStyle(element).backgroundColor,
      textColor: globalThis.getComputedStyle(textElement).color,
    };
  });
}

async function expectButtonAppearance(
  button: Locator,
  appearance: ButtonAppearance,
): Promise<void> {
  await expect.poll(() => buttonAppearance(button)).toEqual(appearance);
}

async function scrollGeometry(scroll: Locator): Promise<ScrollGeometry> {
  return scroll.evaluate((element): ScrollGeometry => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
}

async function scrollTarget(scroll: Locator): Promise<number> {
  const geometry = await scrollGeometry(scroll);
  const target = Math.min(700, geometry.scrollHeight - geometry.clientHeight);
  expect(target).toBeGreaterThan(200);
  return target;
}

async function wheelSidebar(sidebar: SidebarHarness, deltaY: number): Promise<void> {
  const scrollBox = await sidebar.scroll.boundingBox();
  expect(scrollBox).not.toBeNull();
  if (!scrollBox) throw new Error("Sidebar scroll container has no bounding box");

  await sidebar.page.mouse.move(
    scrollBox.x + scrollBox.width / 2,
    scrollBox.y + scrollBox.height / 2,
  );
  await sidebar.page.mouse.wheel(0, deltaY);
  await expect.poll(() => sidebar.scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
}

playwrightTest?.("search focus survives programmatic scroll and shortcut-bearing input", async ({ sidebar }) => {
  const { page, scroll, search } = sidebar;
  const emptySelection = page.getByText("Select a conversation", { exact: true });
  await expect(emptySelection).toBeVisible();

  await search.click();
  await expect(search).toBeFocused();

  const target = await scrollTarget(scroll);
  await wheelSidebar(sidebar, target);
  await search.pressSequentially(COMMAND_BEARING_QUERY);

  await expect(search).toHaveValue(COMMAND_BEARING_QUERY);
  await expect(search).toBeFocused();
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
  await expect(emptySelection).toBeVisible();
});

playwrightTest?.("desktop title and search remain fixed while the queue scrolls", async ({ sidebar }) => {
  const { heading, scroll, search } = sidebar;
  const headingBefore = await heading.boundingBox();
  const searchBefore = await search.boundingBox();
  expect(headingBefore).not.toBeNull();
  expect(searchBefore).not.toBeNull();
  if (!headingBefore || !searchBefore) throw new Error("Desktop chrome must have bounding boxes");

  const target = await scrollTarget(scroll);
  await wheelSidebar(sidebar, target);

  const headingAfter = await heading.boundingBox();
  const searchAfter = await search.boundingBox();
  expect(headingAfter).not.toBeNull();
  expect(searchAfter).not.toBeNull();
  if (!headingAfter || !searchAfter) throw new Error("Desktop chrome disappeared after scrolling");

  expect(headingAfter.x).toBeCloseTo(headingBefore.x, 1);
  expect(headingAfter.y).toBeCloseTo(headingBefore.y, 1);
  expect(searchAfter.x).toBeCloseTo(searchBefore.x, 1);
  expect(searchAfter.y).toBeCloseTo(searchBefore.y, 1);
});

playwrightTest?.("web wheel and query-reset scrolling retain search focus", async ({ sidebar }) => {
  const { scroll, search } = sidebar;
  await search.click();
  await expect(search).toBeFocused();

  const target = await scrollTarget(scroll);
  await wheelSidebar(sidebar, target);
  await expect(search).toBeFocused();

  await search.pressSequentially(QUERY_RESET_TEXT);
  await expect(search).toHaveValue(QUERY_RESET_TEXT);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
  await expect(search).toBeFocused();
});

playwrightTest?.("navigation rail shows conversation counts for every inbox group", async ({ sidebar }) => {
  const { page } = sidebar;

  for (const label of ["Needs", "Waiting", "All"] as const) {
    const button = lensButton(page, label);
    await expect(button).toBeVisible();
    await expect(button.getByText(/^\d+(?:\+)?$/)).toBeVisible();
  }
});

playwrightTest?.("search and Triage Desk lenses supersede each other", async ({ sidebar }) => {
  const { page, search } = sidebar;
  const needs = lensButton(page, "Needs");
  const waiting = lensButton(page, "Waiting");
  const all = lensButton(page, "All");

  const selectedAppearance = await buttonAppearance(needs);
  const unselectedAppearance = await buttonAppearance(waiting);
  expect(selectedAppearance).not.toEqual(unselectedAppearance);

  await waiting.click();
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expectButtonAppearance(waiting, selectedAppearance);
  await expectButtonAppearance(needs, unselectedAppearance);

  await search.click();
  await search.pressSequentially("first search");
  await expect(search).toHaveValue("first search");
  await expect(page.getByRole("heading", { name: "All messages" })).toBeVisible();
  await expectButtonAppearance(all, selectedAppearance);

  const clearSearch = page.getByRole("button", { name: "Clear search" });
  await clearSearch.click();
  await expect(search).toHaveValue("");
  await expect(clearSearch).toBeHidden();
  await expectButtonAppearance(all, selectedAppearance);

  await search.click();
  await search.pressSequentially("second search");
  await waiting.click();

  await expect(search).toHaveValue("");
  await expect(page.getByRole("button", { name: "Clear search" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expectButtonAppearance(waiting, selectedAppearance);
});

playwrightTest?.("conversation rows stay constant-height while hover actions appear", async ({ sidebar }) => {
  const row = sidebar.page.getByTestId("conversation-row").nth(1);
  await expect(row).toBeVisible();
  const before = await row.boundingBox();
  expect(before).not.toBeNull();
  if (!before) throw new Error("Conversation row has no bounding box");
  expect(before.height).toBeCloseTo(68, 1);

  await row.hover();
  await expect(row.getByText("Settle", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: /More actions for/ })).toBeVisible();
  await expect(row.getByText("Reply", { exact: true })).toHaveCount(0);
  const after = await row.boundingBox();
  expect(after).not.toBeNull();
  if (!after) throw new Error("Conversation row disappeared after hover");
  expect(after.height).toBeCloseTo(before.height, 1);
});
