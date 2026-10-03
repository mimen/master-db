import { expect, test } from "../fixtures/desk";

test("the composer grows with the draft up to six lines, then scrolls", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?growth", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
  await page.getByTestId("conversation-row").first().click();
  const composer = page.getByPlaceholder("iMessage");
  const height = async () => (await composer.boundingBox())!.height;

  const oneLine = await height();
  await composer.fill("one\ntwo");
  const twoLines = await height();
  expect(twoLines, "grows past one line").toBeGreaterThan(oneLine + 10);

  await composer.fill(Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n"));
  expect(await composer.evaluate((element) => getComputedStyle(element).overflowY), "six lines fit").toBe("hidden");
  await composer.fill(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"));
  const capped = await height();
  expect(capped, "about six lines tall, not twelve").toBeLessThan(oneLine + 6 * 22);
  expect(await composer.evaluate((element) => getComputedStyle(element).overflowY), "then scrolls").toBe("auto");
  await composer.fill(Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"));
  expect(await height(), "cap holds").toBe(capped);
  await page.screenshot({ path: "/tmp/comma-ui-batch-e/after/composer-capped-desk.png", animations: "disabled" });

  await composer.fill("");
  expect(await height(), "shrinks back after clearing").toBe(oneLine);
});
