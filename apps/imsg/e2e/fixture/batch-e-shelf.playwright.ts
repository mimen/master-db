import { expect, test } from "../fixtures/desk";

for (const scheme of ["light", "dark"] as const) {
  test(`shelf pills share one neutral fill and stay one row on phone (${scheme})`, async ({ desk }) => {
    const page = desk.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`/?shelf=${scheme}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("radio", { name: /All, 16 conversations/ })).toBeVisible();
    await page.waitForTimeout(800);
    await page.getByText("Alex Rivera", { exact: true }).filter({ visible: true }).first().click();

    const pills = [
      page.getByRole("button", { name: /^clarify, curious:/ }),
      page.getByRole("button", { name: /^decline, boundary:/ }),
      page.getByRole("button", { name: /^react, playful:/ }),
    ];
    await expect(pills[0]).toBeVisible();
    await page.waitForTimeout(400);
    const fills = new Set<string>();
    const tops = new Set<number>();
    for (const pill of pills) {
      fills.add(await pill.evaluate((element) => getComputedStyle(element).backgroundColor));
      tops.add(Math.round((await pill.boundingBox())!.y));
    }
    expect(fills.size, "one neutral fill for every vibe").toBe(1);
    expect(tops.size, "one row on phone").toBe(1);
  });
}
