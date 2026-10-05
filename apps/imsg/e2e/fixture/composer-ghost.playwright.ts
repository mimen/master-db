import { expect, test } from "../fixtures/desk";

const OUT = process.env.COMPOSER_SHOTS;
const GHOST = "what time do you need the final answer by?";

for (const scheme of ["light", "dark"] as const) {
  test(`desktop composer: ghost text, Tab accept, ⌥ alternates (${scheme})`, async ({ desk }) => {
    const page = desk.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`/?composer=${scheme}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();

    const composer = page.getByPlaceholder("iMessage");
    const ghost = page.getByTestId("composer-ghost");
    await expect(ghost).toHaveText(GHOST);
    await expect(page.getByTestId("composer-tab-hint")).toBeVisible();
    await expect(page.getByTestId("composer-service")).toContainText("iMessage");
    await expect(page.getByRole("button", { name: "Send later" })).toBeVisible();
    const alternates = page.getByTestId("suggestion-alternates");
    await expect(alternates).toContainText("⌥1");
    await expect(alternates).toContainText("⌥2");
    await expect(alternates).not.toContainText(GHOST);

    const strip = (await page.getByTestId("state-strip").boundingBox())!;
    const field = (await composer.boundingBox())!;
    expect(field.y - (strip.y + strip.height), "the strip sits on the composer card").toBeLessThanOrEqual(2);
    if (OUT) await page.screenshot({ path: `${OUT}/desk-${scheme}.png` });

    await composer.click();
    await composer.pressSequentially("o");
    await expect(page.getByTestId("composer-tab-hint")).toHaveCount(0);
    await composer.fill("");
    await expect(page.getByTestId("composer-tab-hint")).toBeVisible();

    await composer.press("Tab");
    await expect(composer).toHaveValue(GHOST);
    await expect(composer).toBeFocused();

    await composer.fill("");
    await composer.press("Alt+Digit1");
    await expect(composer).toHaveValue("that turnaround is too tight on my end");

    await composer.fill("");
    await composer.press("Alt+Digit2");
    await expect(page.getByText("React 👍", { exact: true })).toBeVisible();
  });
}

test("Suggestions Off shows no ghost and no alternates", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem(
    "imsg.settings.v2",
    JSON.stringify({ suggestionMode: "off", suggestionModel: "opus", nameOrder: "first-last" }),
  ));
  await page.goto("/?composer=off", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).first().click();
  await expect(page.getByPlaceholder("iMessage")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("composer-ghost")).toHaveCount(0);
  await expect(page.getByTestId("suggestion-alternates")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`phone composer: ghost with a Use key, chips below (${scheme})`, async ({ desk }) => {
    const page = desk.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`/chat/${encodeURIComponent("iMessage;-;+16195550101")}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("composer-ghost")).toHaveText(GHOST);
    const use = page.getByTestId("composer-use-ghost");
    await expect(use).toBeVisible();
    const chips = [
      page.getByRole("button", { name: /^decline, boundary:/ }),
      page.getByRole("button", { name: /^react, playful:/ }),
    ];
    const field = (await page.getByPlaceholder("iMessage").boundingBox())!;
    for (const chip of chips) {
      const box = (await chip.boundingBox())!;
      expect(box.y, "chips sit below the field").toBeGreaterThanOrEqual(field.y + field.height);
    }
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${scheme}.png` });

    await use.click();
    await expect(page.getByPlaceholder("iMessage")).toHaveValue(GHOST);
  });
}
