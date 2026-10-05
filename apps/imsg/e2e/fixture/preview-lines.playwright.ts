import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const ALEX = "iMessage;-;+16195550101";
const FIXTURE_GHOST = "what time do you need the final answer by?";
const LONG_GHOST = "honestly I can do Saturday afternoon if that still works for everyone, otherwise Sunday morning before brunch is open too, just let me know which one and I will lock it in with the venue tonight so nobody has to wait";
const LONG_INBOUND = "Hey are you still coming to the showcase on Saturday? I need final set times and the guest list by tonight so I can send everything to the venue before they close for the weekend";

async function renderedLines(text: Locator): Promise<number> {
  return text.evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
}

async function serveLongGhost(page: Page): Promise<void> {
  await page.route("**/__fixture/convex", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).split(FIXTURE_GHOST).join(LONG_GHOST) });
  });
}

for (const [layout, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`${layout} rows preview a long message on two lines`, async ({ desk }) => {
    await desk.page.setViewportSize(viewport);
    await desk.receive(ALEX, LONG_INBOUND);
    await desk.page.goto("/", { waitUntil: "domcontentloaded" });
    const preview = desk.page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().getByText(LONG_INBOUND);
    await expect(preview).toBeVisible();
    expect(await renderedLines(preview)).toBe(2);
  });
}

test("phone ghost suggestion stays inside the composer field", async ({ desk }) => {
  const page = desk.page;
  await serveLongGhost(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/chat/${encodeURIComponent(ALEX)}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });
  const ghost = page.getByTestId("composer-ghost");
  await expect(ghost).toHaveText(LONG_GHOST);
  await expect.poll(() => renderedLines(ghost), { message: "the ghost wraps" }).toBeGreaterThan(1);
  const field = (await page.getByPlaceholder("iMessage").boundingBox())!;
  const box = (await ghost.boundingBox())!;
  expect(box.y + box.height, "the ghost ends inside the field").toBeLessThanOrEqual(field.y + field.height);
});
