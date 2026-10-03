import { mkdirSync } from "node:fs";

import { expect, test } from "../fixtures/desk";

const OUT = process.env.COMMA_GALLERY_DIR ?? "/tmp/comma-ui-batch-d";

for (const scheme of ["light", "dark"] as const) {
  test(`ui primitives render every state in ${scheme}`, async ({ desk }) => {
    mkdirSync(OUT, { recursive: true });
    const page = desk.page;
    await page.setViewportSize({ width: 900, height: 820 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/ui-gallery", { waitUntil: "domcontentloaded" });
    const gallery = page.getByTestId("ui-gallery");
    await expect(gallery).toBeVisible();
    await page.screenshot({ path: `${OUT}/gallery-${scheme}.png`, animations: "disabled" });

    const search = page.getByRole("button", { name: "Search conversation" });
    await expect(search).toHaveCSS("width", "28px");
    await expect(page.getByTestId("pane-header")).toHaveCSS("height", "52px");
    await expect(page.getByRole("button", { name: "Send" })).toHaveCSS("height", "32px");
    await expect(page.getByRole("button", { name: "Regular row, Secondary line" })).toHaveCSS("min-height", "62px");
    await expect(page.getByRole("button", { name: "Compact row" })).toHaveCSS("min-height", "44px");
    await expect(page.getByRole("button", { name: "Small", exact: true })).toHaveCSS("height", "24px");

    const neutral = page.getByRole("button", { name: "Neutral" });
    const rest = await neutral.evaluate((el) => getComputedStyle(el).backgroundColor);
    await neutral.hover();
    await expect(neutral).not.toHaveCSS("background-color", rest);
    await page.screenshot({ path: `${OUT}/gallery-${scheme}-hover.png`, animations: "disabled" });

    await page.mouse.move(0, 0);
    await page.mouse.click(5, 400);
    // The primitive's own ring. Global web CSS may still suppress it until the
    // focus-ring fix in web-css.ts lands.
    const ring = () => search.evaluate((el) => (el as HTMLElement).style.outlineStyle);
    await search.focus();
    expect(await ring()).toBe("");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    expect(await ring()).toBe("solid");
    await page.screenshot({ path: `${OUT}/gallery-${scheme}-focus.png`, animations: "disabled" });

    const send = page.getByRole("button", { name: "Send" });
    const box = await send.boundingBox();
    if (!box) throw new Error("Send button has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.screenshot({ path: `${OUT}/gallery-${scheme}-pressed.png`, animations: "disabled" });
    await page.mouse.up();
  });
}
