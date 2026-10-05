import { expect, test } from "../fixtures/desk";

for (const scheme of ["light", "dark"] as const) {
  test(`alternate chips share one neutral fill and stay one row under the phone field (${scheme})`, async ({ desk }) => {
    const page = desk.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}?name=Alex%20Rivera&shelf=${scheme}`, { waitUntil: "domcontentloaded" });

    // The top suggestion is the field's ghost text; the alternates are the chips under it.
    await expect(page.getByTestId("composer-ghost")).toHaveText("what time do you need the final answer by?");
    const pills = [
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
