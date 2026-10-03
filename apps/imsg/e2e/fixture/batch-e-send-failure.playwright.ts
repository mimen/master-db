import { expect, test } from "../fixtures/desk";

test("a burst of failed sends raises one toast and keeps every Not Delivered bubble", async ({ desk }) => {
  const page = desk.page;
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll("div")) {
        const text = node.textContent ?? "";
        if (text === "Couldn't send. Check the Mini connection." && node.children.length === 0 && !node.dataset.counted) {
          node.dataset.counted = "1";
          seen.push(text);
        }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?send-failure", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
  await page.getByTestId("conversation-row").first().click();
  await desk.request.post("/__fixture/fault", { data: { method: "sendText", error: "offline" } });

  const composer = page.getByPlaceholder("iMessage");
  for (const text of ["first failed probe", "second failed probe", "third failed probe"]) {
    await composer.fill(text);
    await composer.press("Enter");
    await page.waitForTimeout(150);
  }
  await expect(page.getByText(/Not Delivered/)).toHaveCount(3);
  const toast = page.getByText("Couldn't send. Check the Mini connection.");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 4_000 });
  await composer.fill("fourth failed probe, same burst");
  await composer.press("Enter");
  await expect(page.getByText(/Not Delivered/)).toHaveCount(4);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.length)).toBe(1);
  await desk.request.post("/__fixture/fault", { data: { method: null } });
});
