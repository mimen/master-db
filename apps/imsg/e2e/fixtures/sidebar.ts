import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

const HEALTH_PATH = "/api/health";
const SEARCH_NAME = "Search conversations and messages";

export interface SidebarHarness {
  readonly heading: Locator;
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
        { message: "imsg health endpoint should return ok" },
      )
      .toBe(true);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const search = page.getByRole("textbox", { name: SEARCH_NAME });
    const heading = page.getByRole("heading", { name: "Needs reply" });
    const needs = page.getByRole("button", { name: /^Needs, \d+/ });
    const waiting = page.getByRole("button", { name: "Waiting" });
    const all = page.getByRole("button", { name: "All" });
    const scroll = page.getByTestId("conversation-list-scroll");

    await expect(search).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(needs).toBeVisible();
    await expect(waiting).toBeVisible();
    await expect(all).toBeVisible();
    await expect(scroll).toBeVisible();
    await expect
      .poll(async (): Promise<boolean> => {
        const firstHeight = await scroll.evaluate((element) => element.scrollHeight);
        await page.waitForTimeout(100);
        const secondHeight = await scroll.evaluate((element) => element.scrollHeight);
        const viewportHeight = await scroll.evaluate((element) => element.clientHeight);
        return secondHeight > viewportHeight + 200 && secondHeight === firstHeight;
      })
      .toBe(true);

    await provide({ heading, page, scroll, search });
  },
});

export { expect };
