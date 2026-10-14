import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

/** Answers the next request for `name` with the server error Convex returned in production. */
async function failNext(page: Page, name: string): Promise<() => boolean> {
  let armed = false;
  let failed = false;
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string };
    if (!armed || failed || body.name !== name) return route.continue();
    failed = true;
    await route.fulfill({ status: 500, body: "[CONVEX Q(comma/queries:listConversations)] Server Error: too many system operations" });
  });
  return () => {
    armed = true;
    return failed;
  };
}

for (const name of ["comma/queries:listConversations", "comma/queries:listMessages"]) {
  test(`a failed ${name.split(":")[1]} page keeps the open conversation and recovers`, async ({ desk }) => {
    const page = desk.page;
    const arm = await failNext(page, name);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("conversation-row");
    const alex = rows.filter({ hasText: "Alex Rivera" });
    const thread = page.getByTestId("thread-view");
    await alex.click();
    await expect(thread.getByText("Can you send the final arrival time?", { exact: true })).toBeVisible();

    arm();
    await expect.poll(() => arm(), { message: "the query failed once" }).toBe(true);
    await page.waitForTimeout(500);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(alex).toHaveAttribute("aria-selected", "true");
    await expect(thread.getByText("Can you send the final arrival time?", { exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Nina Park" })).toBeVisible();

    await desk.receive(desk.chats.needs, "Recovered after the failed page.", "+16195550101");
    await expect(thread.getByText("Recovered after the failed page.", { exact: true })).toBeVisible();
    await expect(alex).toContainText("Recovered after the failed page.");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
}
