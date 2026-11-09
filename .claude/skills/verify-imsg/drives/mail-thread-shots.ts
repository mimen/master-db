import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

const out = join(process.env.VERIFY_IMSG_EVIDENCE!, process.env.SHOTS ?? "shots");

test.setTimeout(120_000);

test("mail-thread-shots: source icons in Today and a long quoted thread, light and dark, desktop and phone", async ({ desk }) => {
  mkdirSync(out, { recursive: true });
  const page = desk.page;
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await desk.request.post("/__fixture/slack", { data: { seed: true } });
  await desk.request.post("/__fixture/mail", { data: { longThread: true } });

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("conversation-row").first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `list-${scheme}.png`), clip: { x: 0, y: 0, width: 352, height: 900 }, animations: "disabled" });

    await page.goto("/mail", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Jordan Kim, March routing" }).click();
    const reader = page.getByTestId("email-reader");
    await expect(reader.getByRole("heading", { name: "March routing" })).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, `thread-desktop-${scheme}.png`), animations: "disabled" });
    if (process.env.EXPAND === "1") {
      const folded = reader.locator('[data-testid="email-card"][aria-expanded="false"]');
      while (await folded.count()) await folded.first().click();
      for (const frame of await reader.locator("iframe").all()) {
        const summaries = frame.contentFrame().locator("details.comma-fold > summary");
        for (const summary of await summaries.all()) await summary.click();
      }
      for (const fold of await reader.getByRole("button", { name: "Show quoted text" }).all()) await fold.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `thread-desktop-expanded-${scheme}.png`), animations: "disabled" });
    }

    if (process.env.EXPAND === "1") {
      await page.setViewportSize({ width: 900, height: 900 });
      await page.goto("/ui-gallery", { waitUntil: "domcontentloaded" });
      const strip = page.getByTestId("source-icons-16");
      await strip.scrollIntoViewIfNeeded();
      const top = (await page.getByTestId("source-icons-14").boundingBox())!;
      const bottom = (await strip.boundingBox())!;
      await page.screenshot({ path: join(out, `icons-${scheme}.png`), clip: { x: 0, y: top.y - 10, width: 620, height: bottom.y + bottom.height - top.y + 20 }, animations: "disabled" });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/mail", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Jordan Kim, March routing" }).click();
    await expect(page.getByTestId("email-reader").getByRole("heading", { name: "March routing" })).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, `thread-phone-${scheme}.png`), animations: "disabled" });
    if (process.env.EXPAND === "1") {
      const reader = page.getByTestId("email-reader");
      const folded = reader.locator('[data-testid="email-card"][aria-expanded="false"]');
      while (await folded.count()) await folded.first().click();
      for (const frame of await reader.locator("iframe").all()) {
        for (const summary of await frame.contentFrame().locator("details.comma-fold > summary").all()) await summary.click();
      }
      for (const fold of await reader.getByRole("button", { name: "Show quoted text" }).all()) await fold.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `thread-phone-expanded-${scheme}.png`), animations: "disabled" });
    }
  }
});
