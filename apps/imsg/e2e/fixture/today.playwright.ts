import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

async function todayCount(page: Page): Promise<number> {
  const label = await page.getByRole("tab", { name: /^Today, \d+/ }).getAttribute("aria-label");
  return Number(/(\d+)/.exec(label ?? "")?.[1]);
}

test("the app opens on Today; a settle leaves a rank gap and moves progress; Regenerate folds New since into the groups", async ({ desk }) => {
  const { page } = desk;
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: /^Today, \d+/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("today-meta")).toHaveText("Built 10:30 AM · Opus 5.5 · 12 of 15 threads");
  await expect(page.getByText("New since 10:30 AM", { exact: true })).toBeVisible();
  const rows = page.getByTestId("conversation-row");
  const alex = rows.filter({ hasText: "Alex Rivera" });
  await expect(alex.getByTestId("today-reason")).toHaveText("The final arrival time unblocks the run of show.");
  await expect(page.getByTestId("today-progress")).toHaveText("0 settled · 13 to go");

  await rows.filter({ hasText: "Priya Shah" }).click();
  await expect(page.getByTestId("strip-today")).toHaveText("#2 todayGuest list locks at 6 PM.");
  await page.getByTestId("thread-settle").click();
  await expect.poll(() => todayCount(page)).toBe(12);
  await expect(page.getByTestId("today-progress")).toHaveText("1 settled · 12 to go");
  await alex.click();
  await expect(rows.filter({ hasText: "Priya Shah" })).toHaveCount(0);
  expect((await page.getByTestId("today-rank").allTextContents()).slice(0, 3)).toEqual(["", "1", "3"]);

  await page.getByTestId("today-regenerate").click();
  await expect(page.getByTestId("today-regenerate")).toHaveText("Regenerating");
  await expect(page.getByTestId("today-regenerate")).toHaveText("Regenerate", { timeout: 10_000 });
  await expect(page.getByText("New since 10:30 AM", { exact: true })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Launch Crew" }).getByTestId("today-rank")).toHaveText("1");
  await expect(page.getByTestId("today-progress")).toHaveText("1 settled · 13 to go");
});
