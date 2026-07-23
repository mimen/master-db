import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

const HEALTH_PATH = "/api/health";
const SEARCH_NAME = "Search conversations and messages";
const SCROLL_MARKER = "data-imsg-e2e-sidebar-scroll";

export interface SidebarHarness {
  readonly chrome: Locator;
  readonly page: Page;
  readonly scroll: Locator;
  readonly search: Locator;
}

interface SidebarFixtures {
  readonly sidebar: SidebarHarness;
}

export const test = base.extend<SidebarFixtures>({
  sidebar: async ({ page, request }, provide): Promise<void> => {
    await expect
      .poll(
        async (): Promise<boolean> => {
          try {
            const response = await request.get(HEALTH_PATH);
            const body = await response.text();
            return response.ok() && /"ok"\s*:\s*true/.test(body);
          } catch {
            return false;
          }
        },
        { message: "live imsg health endpoint should return ok" },
      )
      .toBe(true);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const search = page.getByRole("textbox", { name: SEARCH_NAME });
    const stateFilters = page.getByRole("radiogroup", { name: "Conversation state" });
    const loadedAllPill = page.getByRole("radio", {
      name: /^All, \d+ conversations$/,
    });
    const filterButton = page.getByRole("button", { name: "Filter conversations" });

    await expect(search).toBeVisible();
    await expect(stateFilters).toBeVisible();
    await expect(loadedAllPill).toBeVisible();
    await expect(filterButton).toBeVisible();

    await search.evaluate((input, marker): void => {
      let element = input.parentElement;
      while (element) {
        const style = globalThis.getComputedStyle(element);
        const verticallyScrollable = style.overflowY === "auto" || style.overflowY === "scroll";
        if (verticallyScrollable) {
          element.setAttribute(marker, "true");
          return;
        }
        element = element.parentElement;
      }
      throw new Error("Could not find the sidebar scroll container");
    }, SCROLL_MARKER);

    const scroll = page.locator(`[${SCROLL_MARKER}="true"]`);
    const chrome = filterButton.locator("..").locator("..");
    await expect(scroll).toHaveCount(1);
    await expect(chrome).toBeVisible();
    await expect
      .poll(async (): Promise<boolean> => {
        const firstHeight = await scroll.evaluate((element) => element.scrollHeight);
        await page.waitForTimeout(100);
        const secondHeight = await scroll.evaluate((element) => element.scrollHeight);
        const viewportHeight = await scroll.evaluate((element) => element.clientHeight);
        return secondHeight > viewportHeight + 200 && secondHeight === firstHeight;
      })
      .toBe(true);

    await provide({ chrome, page, scroll, search });
  },
});

export { expect };
