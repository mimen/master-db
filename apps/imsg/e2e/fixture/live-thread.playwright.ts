import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const NINA_ADDRESS = "+16195550201";
const NINA = `iMessage;-;${NINA_ADDRESS}`;

/** Holds every messages fetch for `chatGuid` until the returned release runs. */
async function holdThreadFetches(page: Page, chatGuid: string): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string; args: { conversationId?: string } };
    if (body.name !== "comma/queries:listMessages" || body.args.conversationId !== chatGuid) {
      return route.continue();
    }
    await gate;
    await route.continue();
  });
  return release;
}

for (const history of ["opened earlier", "never opened"] as const) {
  test(`a message seen in the sidebar is in the thread before its fetch lands: chat ${history}`, async ({ desk }) => {
    const page = desk.page;
    const stream = page.waitForRequest((request) => request.url().endsWith("/events"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await stream;
    const rows = page.getByTestId("conversation-row");
    const thread = page.getByTestId("thread-view");
    const nina = rows.filter({ hasText: "Nina Park" });
    if (history === "opened earlier") {
      await nina.click();
      await expect(thread.getByText("Any update when you get a chance?", { exact: true })).toBeVisible();
    }
    await rows.filter({ hasText: "Alex Rivera" }).click();
    await expect(thread.getByText("Can you send the final arrival time?", { exact: true })).toBeVisible();

    const inbound = `Production signed off (${history})`;
    await desk.receive(NINA, inbound, NINA_ADDRESS);
    await expect(nina).toContainText(inbound);

    const release = await holdThreadFetches(page, NINA);
    try {
      await nina.click();
      await expect(thread.getByText(inbound, { exact: true })).toBeVisible({ timeout: 3_000 });
      release();
      await expect(thread.getByText("Following up on Nina's plan.", { exact: true })).toBeVisible();
      await expect(thread.getByText(inbound, { exact: true })).toHaveCount(1);
    } finally {
      release();
    }
  });
}
