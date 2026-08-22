import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

async function expectHoverStable(control: Locator): Promise<void> {
  if (!(await control.isVisible()) || !(await control.isEnabled())) return;
  const before = await control.boundingBox();
  if (!before) return;
  const viewport = control.page().viewportSize();
  if (!viewport || before.x < 0 || before.y < 0 || before.x + before.width > viewport.width || before.y + before.height > viewport.height) return;
  const receivesPointer = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || (hit !== null && element.contains(hit));
  });
  if (!receivesPointer) return;
  await control.hover();
  await expect(control).toBeVisible();
  expect(await control.boundingBox()).toEqual(before);
}

const WIDTHS = [820, 900, 1039, 1040, 1280, 1300, 1440, 1512] as const;
const SCHEMES = ["light", "dark"] as const;

async function resetAndOpen(desk: Parameters<Parameters<typeof test>[1]>[0]["desk"], width: number, scheme: "light" | "dark"): Promise<void> {
  await desk.request.post("/__fixture/reset");
  await desk.page.setViewportSize({ width, height: 820 });
  await desk.page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await desk.page.goto(`/?visual=${scheme}-${width}`, { waitUntil: "domcontentloaded" });
  await expect(desk.page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
}

test("desktop width, theme, glass, rail, row, and hover matrix", async ({ desk }, testInfo) => {
  test.setTimeout(180_000);
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      await resetAndOpen(desk, width, scheme);
      const page = desk.page;
      const rail = page.getByTestId("triage-rail").first();
      const header = page.getByTestId("triage-queue-header");
      const needsReply = rail.getByRole("button", { name: /^Needs reply/ });
      const rows = page.getByTestId("conversation-row");

      await expect(rail).toBeVisible();
      await expect(header).toBeVisible();
      await expect(page.getByTestId("window-controls")).toHaveCount(0);
      expect(await rail.getAttribute("data-tauri-drag-region")).toBe("");
      await expect(rail.locator("svg")).toHaveCount(6);
      for (const control of await rail.getByRole("button").all()) {
        expect(await control.getAttribute("data-tauri-drag-region")).toBe("false");
        const icon = control.locator("svg");
        await expect(icon).toHaveCount(1);
        await expect(icon).toBeVisible();
        expect(await icon.locator("path").count()).toBeGreaterThan(0);
        const iconBox = await icon.boundingBox();
        expect(iconBox?.width).toBeGreaterThan(0);
        expect(iconBox?.height).toBeGreaterThan(0);
        const strokes = await icon.locator("path").evaluateAll((paths) =>
          paths.map((path) => getComputedStyle(path).stroke),
        );
        expect(strokes.every((stroke) => stroke !== "none" && stroke !== "rgba(0, 0, 0, 0)")).toBe(true);
      }
      await expect(needsReply.locator("svg")).toBeVisible();
      const railBox = await rail.boundingBox();
      const headerBox = await header.boundingBox();
      const needsReplyBox = await needsReply.boundingBox();
      expect(railBox?.width).toBeCloseTo(64, 1);
      expect(headerBox?.height).toBeCloseTo(112, 1);
      expect(needsReplyBox?.y).toBeGreaterThanOrEqual(38);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const closerRow = rows.first();
      const closer = closerRow.getByRole("button", { name: "Fill AI draft" });
      const closerBefore = await closer.boundingBox();
      const closerRowBefore = await closerRow.boundingBox();
      await closer.hover();
      await expect(closer).toBeVisible();
      expect(await closer.boundingBox()).toEqual(closerBefore);
      expect(await closerRow.boundingBox()).toEqual(closerRowBefore);

      const actionRow = rows.nth(1);
      const rowBefore = await actionRow.boundingBox();
      await actionRow.click();
      await expect(actionRow.getByText("Reply", { exact: true })).toBeVisible();
      await expect(actionRow.getByText("Done", { exact: true })).toBeVisible();
      await expect(actionRow.getByText("Later", { exact: true })).toBeVisible();
      const rowAfter = await actionRow.boundingBox();
      expect(rowBefore?.height).toBeCloseTo(82, 1);
      expect(rowAfter).toEqual(rowBefore);
      expect(await actionRow.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("11px");

      for (const button of await rail.getByRole("button").all()) {
        if (!(await button.isEnabled())) continue;
        const before = await button.boundingBox();
        await button.hover();
        await expect(button).toBeVisible();
        expect(await button.boundingBox()).toEqual(before);
      }

      await page.screenshot({ path: `/tmp/comma-matrix-${scheme}-${width}.png`, animations: "disabled" });
    }
  }
  await testInfo.attach("matrix-note", { body: Buffer.from("Screenshots: /tmp/comma-matrix-{light,dark}-{820,900,1039,1040,1280,1300,1440,1512}.png"), contentType: "text/plain" });
});

test("thread, resolve strip, inspector breakpoint, and global Sweep geometry", async ({ desk }) => {
  test.setTimeout(60_000);
  for (const width of [900, 1039, 1040, 1300]) {
    await resetAndOpen(desk, width, "light");
    const page = desk.page;
    await page.getByTestId("conversation-row").first().click();
    await expect(page.getByTestId("resolve-strip")).toBeVisible();
    const stripBox = await page.getByTestId("resolve-strip").boundingBox();
    expect(stripBox?.height).toBeGreaterThanOrEqual(40);

    await page.keyboard.press("Meta+i");
    await expect(page.getByText("Details", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Meta+i");

    await page.getByRole("button", { name: /Start sweep/ }).click();
    const backdrop = page.getByTestId("sweep-backdrop");
    const card = page.getByTestId("sweep-card");
    await expect(backdrop).toBeVisible();
    await expect(card).toBeVisible();
    const backdropBox = await backdrop.boundingBox();
    const cardBox = await card.boundingBox();
    expect(backdropBox?.width).toBeCloseTo(width, 1);
    expect(cardBox?.width).toBeCloseTo(Math.min(560, width - 48), 1);
    expect(cardBox!.x).toBeGreaterThan(0);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/comma-sweep-light-${width}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Close sweep" }).click();
  }
});

test("native window chrome reserves space only while AppKit controls are visible", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "light");
  const rail = desk.page.getByTestId("triage-rail").first();
  const needsReply = rail.getByRole("button", { name: /^Needs reply/ });

  await expect(desk.page.getByTestId("window-controls")).toHaveCount(0);
  await expect(needsReply.locator("svg")).toBeVisible();
  const windowedBox = await needsReply.boundingBox();
  expect(windowedBox?.y).toBeGreaterThanOrEqual(38);
  await expect
    .poll(() => desk.page.evaluate(() =>
      (window as Window & { __fixtureHasFullscreenListener?: () => boolean }).__fixtureHasFullscreenListener?.() ?? false,
    ))
    .toBe(true);

  await desk.page.evaluate(() => {
    (window as Window & { __fixtureSetFullscreen?: (value: boolean) => void }).__fixtureSetFullscreen?.(true);
  });
  await expect
    .poll(async () => (await needsReply.boundingBox())?.y)
    .toBeLessThanOrEqual(18);

  await desk.page.evaluate(() => {
    (window as Window & { __fixtureSetFullscreen?: (value: boolean) => void }).__fixtureSetFullscreen?.(false);
  });
  await expect
    .poll(async () => (await needsReply.boundingBox())?.y)
    .toBeGreaterThanOrEqual(38);
});

test("every visible control remains stable and usable on hover", async ({ desk }) => {
  test.setTimeout(120_000);
  for (const scheme of SCHEMES) {
    await resetAndOpen(desk, 1300, scheme);
    const page = desk.page;

    for (const control of await page.getByRole("button").all()) await expectHoverStable(control);
    await page.screenshot({ path: `/tmp/comma-hover-queue-${scheme}.png`, animations: "disabled" });

    await page.getByTestId("conversation-row").nth(1).click();
    await expect(page.getByTestId("resolve-strip")).toBeVisible();
    for (const control of await page.getByRole("button").all()) await expectHoverStable(control);
    await page.screenshot({ path: `/tmp/comma-hover-thread-${scheme}.png`, animations: "disabled" });

    await page.keyboard.press("Meta+i");
    await expect(page.getByText("Details", { exact: true })).toBeVisible();
    for (const control of await page.getByRole("button").all()) await expectHoverStable(control);
    await page.screenshot({ path: `/tmp/comma-hover-inspector-${scheme}.png`, animations: "disabled" });
    await page.keyboard.press("Meta+i");

    await page.getByRole("button", { name: /Start sweep/ }).click();
    await expect(page.getByTestId("sweep-card")).toBeVisible();
    for (const control of await page.getByTestId("sweep-card").getByRole("button").all()) await expectHoverStable(control);
    await page.screenshot({ path: `/tmp/comma-hover-sweep-${scheme}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Close sweep" }).click();
  }
});

test("messages send through the real UI and fixture replies arrive over SSE", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "light");
  const page = desk.page;
  await page.getByTestId("conversation-row").first().click();
  const composer = page.getByRole("textbox").last();
  const outbound = "Fixture outbound: doors confirmed at eight.";
  await composer.fill(outbound);
  await composer.press("Enter");
  await expect(page.getByText(outbound, { exact: true }).last()).toBeVisible();

  const inbound = "Fixture inbound: perfect, see you there.";
  await desk.receive(desk.chats.needs, inbound, "+16195550101");
  await expect(page.getByText(inbound, { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-send-receive-fixture.png", animations: "disabled" });
});

test("Sweep shows a cleared-item trail and real undo", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "light");
  const page = desk.page;
  await page.getByRole("button", { name: /Start sweep/ }).click();
  const card = page.getByTestId("sweep-card");
  await card.getByRole("button", { name: "Mark current conversation done" }).click();
  await expect(card.getByText(/Alex Rivera · cleared/)).toBeVisible();
  await card.getByText("skip ⇢", { exact: true }).click();
  await expect(card.getByText("Avery Brooks", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-sweep-cleared-trail.png", animations: "disabled" });
  await card.getByText("Z undoes the last clear", { exact: true }).click();
  await expect(card.getByText(/Alex Rivera · cleared/)).toBeHidden();
  await expect(card.getByText("Alex Rivera", { exact: true })).toBeVisible();
});
