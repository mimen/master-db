import type { Locator, Page } from "@playwright/test";
import { expect, test, type SidebarHarness } from "./fixtures/sidebar";

const playwrightTest = "Bun" in globalThis ? undefined : test;
const COMMAND_BEARING_QUERY = "jkeucz";
const QUERY_RESET_TEXT = "q";

interface PillAppearance {
  readonly backgroundColor: string;
  readonly textColor: string;
}

interface ScrollGeometry {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}

function statePill(page: Page, label: "All" | "Unread"): Locator {
  return page.getByRole("radio", {
    name: new RegExp(`^${label}(?:, \\d+ conversations)?$`),
  });
}

async function pillAppearance(pill: Locator): Promise<PillAppearance> {
  return pill.evaluate((element): PillAppearance => {
    const textElement = element.firstElementChild ?? element;
    return {
      backgroundColor: globalThis.getComputedStyle(element).backgroundColor,
      textColor: globalThis.getComputedStyle(textElement).color,
    };
  });
}

async function expectPillAppearance(
  pill: Locator,
  appearance: PillAppearance,
): Promise<void> {
  await expect.poll(() => pillAppearance(pill)).toEqual(appearance);
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
  const initialSelectionText = await emptySelection.innerText();

  await search.click();
  await expect(search).toBeFocused();

  const target = await scrollTarget(scroll);
  await wheelSidebar(sidebar, target);
  await search.pressSequentially(COMMAND_BEARING_QUERY);

  await expect(search).toHaveValue(COMMAND_BEARING_QUERY);
  await expect(search).toBeFocused();
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
  await expect(page.getByText(initialSelectionText, { exact: true })).toBeVisible();
});

playwrightTest?.("desktop search scrolls away while chrome remains fixed", async ({ sidebar }) => {
  const { chrome, scroll, search } = sidebar;
  const chromeBefore = await chrome.boundingBox();
  const searchBefore = await search.boundingBox();
  const scrollBox = await scroll.boundingBox();
  expect(chromeBefore).not.toBeNull();
  expect(searchBefore).not.toBeNull();
  expect(scrollBox).not.toBeNull();
  if (!chromeBefore || !searchBefore || !scrollBox) {
    throw new Error("Sidebar elements must have bounding boxes");
  }

  expect(searchBefore.y).toBeGreaterThanOrEqual(chromeBefore.y + chromeBefore.height);
  const target = await scrollTarget(scroll);
  await wheelSidebar(sidebar, target);

  const chromeAfter = await chrome.boundingBox();
  const searchAfter = await search.boundingBox();
  expect(chromeAfter).not.toBeNull();
  expect(searchAfter).not.toBeNull();
  if (!chromeAfter || !searchAfter) {
    throw new Error("Sidebar elements lost their bounding boxes after scrolling");
  }

  expect(chromeAfter.x).toBeCloseTo(chromeBefore.x, 1);
  expect(chromeAfter.y).toBeCloseTo(chromeBefore.y, 1);
  expect(chromeAfter.width).toBeCloseTo(chromeBefore.width, 1);
  expect(chromeAfter.height).toBeCloseTo(chromeBefore.height, 1);
  expect(searchAfter.y).toBeLessThan(searchBefore.y);
  expect(searchAfter.y + searchAfter.height).toBeLessThan(scrollBox.y);
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

playwrightTest?.("search and conversation lenses supersede each other", async ({ sidebar }) => {
  const { page, search } = sidebar;
  const allPill = statePill(page, "All");
  const unreadPill = statePill(page, "Unread");

  await expect(allPill).toHaveAccessibleName(/^All, \d+ conversations$/);
  await expect(unreadPill).toHaveAccessibleName(/^Unread, \d+ conversations$/);
  await expect(allPill).toContainText("All");
  await expect(unreadPill).toContainText("Unread");

  const selectedAppearance = await pillAppearance(allPill);
  const unselectedAppearance = await pillAppearance(unreadPill);
  expect(selectedAppearance).not.toEqual(unselectedAppearance);

  await unreadPill.click();
  await expectPillAppearance(unreadPill, selectedAppearance);
  await expectPillAppearance(allPill, unselectedAppearance);

  await search.click();
  await search.pressSequentially("first search");
  await expect(search).toHaveValue("first search");
  await expectPillAppearance(allPill, selectedAppearance);
  await expectPillAppearance(unreadPill, unselectedAppearance);

  const clearSearch = page.getByRole("button", { name: "Clear search" });
  await clearSearch.click();
  await expect(search).toHaveValue("");
  await expect(clearSearch).toBeHidden();
  await expectPillAppearance(allPill, selectedAppearance);

  await search.click();
  await search.pressSequentially("second search");
  await expect(search).toHaveValue("second search");
  await unreadPill.click();

  await expect(search).toHaveValue("");
  await expect(page.getByRole("button", { name: "Clear search" })).toBeHidden();
  await expectPillAppearance(unreadPill, selectedAppearance);
  await expectPillAppearance(allPill, unselectedAppearance);
});
