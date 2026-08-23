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

async function resetAndOpen(
  desk: Parameters<Parameters<typeof test>[1]>[0]["desk"],
  width: number,
  scheme: "light" | "dark",
  reducedMotion: "reduce" | "no-preference" = "reduce",
): Promise<void> {
  await desk.request.post("/__fixture/reset");
  await desk.page.setViewportSize({ width, height: 820 });
  await desk.page.emulateMedia({ colorScheme: scheme, reducedMotion });
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

test("Scheduled uses the same responsive pane on Messages and Contacts", async ({ desk }) => {
  for (const width of [900, 1300]) {
    await resetAndOpen(desk, width, "dark");
    const page = desk.page;
    const visiblePane = page.locator('[data-testid="desktop-utility-pane-content"]:visible');

    await page.getByRole("button", { name: "Scheduled" }).click();
    await expect(page.getByText("Scheduled", { exact: true }).last()).toBeVisible();
    await expect(visiblePane).toHaveCount(1);
    const messagesBox = await visiblePane.boundingBox();
    await page.screenshot({ path: `/tmp/comma-scheduled-messages-${width}.png`, animations: "disabled" });
    await page.getByLabel("Close scheduled").click();
    await expect(visiblePane).toHaveCount(0);

    await page.getByRole("button", { name: "Contacts" }).click();
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await page.getByRole("button", { name: "Scheduled" }).click();
    await expect(page.getByText("Scheduled", { exact: true }).last()).toBeVisible();
    await expect(visiblePane).toHaveCount(1);
    const contactsBox = await visiblePane.boundingBox();
    await page.screenshot({ path: `/tmp/comma-scheduled-contacts-${width}.png`, animations: "disabled" });

    expect(contactsBox).toEqual(messagesBox);
    await page.getByLabel("Close scheduled").click();
  }
});

test("persistent desktop workspaces keep one rail, selections, and independent searches", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "light");
  const page = desk.page;

  await expect(page.getByTestId("triage-rail")).toHaveCount(1);
  const messageSearch = page.getByLabel("Search conversations and messages");
  await messageSearch.fill("Alex");
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByTestId("resolve-strip")).toBeVisible();

  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByTestId("triage-rail")).toHaveCount(1);
  const contactSearch = page.getByLabel("Search contacts");
  await contactSearch.fill("Jordan");
  await page.getByText("Jordan Lee", { exact: true }).first().click();

  await page.getByRole("button", { name: /^Needs reply/ }).click();
  await expect(messageSearch).toHaveValue("Alex");
  await expect(page.getByTestId("resolve-strip")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-persistent-messages.png", animations: "disabled" });

  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(contactSearch).toHaveValue("Jordan");
  await expect.poll(() => page.getByText("Jordan Lee", { exact: true }).filter({ visible: true }).count()).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: "/tmp/comma-persistent-workspaces.png", animations: "disabled" });
});

test("Scheduled and Settings remain open across every rail destination", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "dark");
  const page = desk.page;
  const visiblePane = page.locator('[data-testid="desktop-utility-pane-content"]:visible');

  await page.getByRole("button", { name: "Scheduled" }).click();
  await expect(visiblePane).toHaveCount(1);
  await expect(page.getByLabel("Close scheduled")).toBeVisible();

  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByTestId("desktop-shell")).toHaveAttribute("data-utility-kind", "scheduled");
  await expect(page.getByTestId("desktop-shell")).toHaveAttribute("data-utility-workspace", "contacts");
  await expect(page.getByLabel("Close scheduled")).toBeVisible();

  await page.getByRole("button", { name: /^Needs reply/ }).click();
  await expect(page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
  await expect(page.getByLabel("Close scheduled")).toBeVisible();

  await page.getByRole("button", { name: "Waiting" }).click();
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(page.getByLabel("Close scheduled")).toBeVisible();

  await page.getByLabel("Close scheduled").click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByText("Settings", { exact: true }).last()).toBeVisible();
  await expect(visiblePane).toHaveCount(1);
});

test("compact tabs keep their eager route structure", async ({ desk }) => {
  await desk.page.setViewportSize({ width: 390, height: 844 });
  await desk.page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(desk.page.getByTestId("triage-rail")).toHaveCount(0);
  await expect(desk.page.getByRole("tab", { name: "Messages" })).toBeVisible();
  await desk.page.getByRole("tab", { name: "Contacts" }).click();
  await expect(desk.page.getByLabel("Search contacts")).toBeVisible();
  await expect(desk.page).toHaveURL(/\/contacts$/);
  await desk.page.getByRole("tab", { name: "Messages" }).click();
  await expect(desk.page.getByLabel("Search conversations and messages")).toBeVisible();
});

test("wide cold routes project into the persistent desktop shell", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/reset");
  await page.setViewportSize({ width: 1300, height: 820 });

  await page.goto("/settings?workspace=contacts", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("triage-rail")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("Settings", { exact: true }).last()).toBeVisible();

  await page.goto("/scheduled?workspace=messages", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Needs reply|Waiting|All messages/ })).toBeVisible();
  await expect(page.getByText("Scheduled", { exact: true }).last()).toBeVisible();

  await page.goto("/person?address=%2B16195550102&name=Jordan%20Lee", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect.poll(() => page.getByText("Jordan Lee", { exact: true }).filter({ visible: true }).count()).toBeGreaterThanOrEqual(2);

  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("resolve-strip")).toBeVisible();

  await page.goto(`/chat-info?guid=${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Details", { exact: true }).last()).toBeVisible();

  await page.goto("/search?query=Alex", { waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder("Search contacts and messages…")).toHaveValue("Alex");

  await page.goto("/new-chat", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("To:", { exact: true })).toBeVisible();

  await page.goto("/forward", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Nothing to forward", { exact: true })).toBeVisible();

  const unknownApi = await desk.request.get("/api/not-real");
  expect(unknownApi.status()).toBe(404);
  expect(unknownApi.headers()["content-type"]).toContain("application/json");
});

test("Scheduled edit state survives crossing the utility-pane breakpoint", async ({ desk }) => {
  for (const [startWidth, endWidth] of [[1039, 1040], [1040, 1039]] as const) {
    await resetAndOpen(desk, startWidth, "dark");
    const page = desk.page;
    await page.getByRole("button", { name: "Scheduled" }).click();
    await page.getByRole("button", { name: "Edit scheduled message to Jordan Lee" }).click();
    const message = page.getByPlaceholder("Message");
    await message.fill(`Preserved across ${startWidth}-${endWidth}`);

    await page.setViewportSize({ width: endWidth, height: 820 });
    await expect(page.getByText("Edit Scheduled Message", { exact: true })).toBeVisible();
    await expect(message).toHaveValue(`Preserved across ${startWidth}-${endWidth}`);
    await page.getByText("Cancel", { exact: true }).click();
    await page.getByLabel("Close scheduled").click();
  }
});

test("a closed utility pane opens in the current breakpoint presentation immediately", async ({ desk }) => {
  for (const [startWidth, endWidth, presentation] of [[1300, 900, "overlay"], [900, 1300, "pane"]] as const) {
    await resetAndOpen(desk, startWidth, "dark");
    const page = desk.page;
    await page.setViewportSize({ width: endWidth, height: 820 });
    await page.getByRole("button", { name: "Scheduled" }).click();

    const pane = page.locator('[data-testid="desktop-utility-pane-content"]:visible');
    await expect(pane).toHaveCount(1);
    await expect(pane).toHaveAttribute("data-utility-presentation", presentation);
    await page.getByLabel("Close scheduled").click();
  }
});

test("the one global utility survives a workspace switch and resize", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "dark");
  const page = desk.page;
  const visiblePane = page.locator('[data-testid="desktop-utility-pane-content"]:visible');

  await page.getByRole("button", { name: "Scheduled" }).click();
  await expect(visiblePane).toHaveCount(1);
  await page.getByRole("button", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 820 });

  await expect(visiblePane).toHaveCount(1);
  await expect(page.getByLabel("Close scheduled")).toBeVisible();
});

test("global command palette applies Messages views from Contacts", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "dark");
  const page = desk.page;
  await page.getByRole("button", { name: "Contacts" }).click();
  await page.keyboard.press("Meta+k");
  const paletteSearch = page.getByPlaceholder("Search or jump to…");
  await paletteSearch.fill("Waiting");
  await page.getByText("Waiting", { exact: true }).last().click();

  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("Cmd+W clears the shell and route selection atomically", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "dark");
  const page = desk.page;
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByTestId("resolve-strip")).toBeVisible();

  await page.keyboard.press("Meta+w");
  await expect(page.getByText("Select a conversation", { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page).toHaveURL(/\/$/);
});

test("Cmd+W closes a route-owned utility and its URL", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "dark");
  const page = desk.page;
  await page.getByRole("button", { name: "Scheduled" }).click();
  await expect(page).toHaveURL(/\/scheduled/);
  await page.keyboard.press("Meta+w");

  await expect(page.locator('[data-testid="desktop-utility-pane-content"]:visible')).toHaveCount(0);
  await expect(page).toHaveURL(/\/(?:\?|$)/);
});

test("Escape clears list search before closing the shell utility", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "dark");
  const page = desk.page;
  const search = page.getByLabel("Search conversations and messages");
  await page.getByRole("button", { name: "Scheduled" }).click();
  await expect(page.getByLabel("Close scheduled")).toBeVisible();
  await search.fill("Alex");

  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Close scheduled")).toBeVisible();
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

test("typing indicator renders from peer presence", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "light", "no-preference");
  await desk.page.getByTestId("conversation-row").first().click();
  await desk.setTyping(desk.chats.needs, true);
  const indicator = desk.page.getByRole("status", { name: "Someone is typing" });
  const firstDot = indicator.locator("div").first();
  await expect(indicator).toBeVisible();
  await expect(indicator.locator("div")).toHaveCount(3);
  const indicatorBox = await indicator.boundingBox();
  const threadBox = await desk.page.getByTestId("resolve-strip").boundingBox();
  expect(indicatorBox?.x).toBeCloseTo((threadBox?.x ?? 0) + 14, 1);

  const positions = await firstDot.evaluate(async (dot) => {
    const samples: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      samples.push(dot.getBoundingClientRect().y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return samples;
  });
  expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(1);
  await desk.page.screenshot({ path: "/tmp/imsg-typing-indicator-after.png" });

  await desk.setTyping(desk.chats.needs, false);
  await expect(indicator).toBeHidden();

  await desk.page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await desk.setTyping(desk.chats.needs, true);
  await expect(indicator).toBeVisible();
  const reducedPositions = await firstDot.evaluate(async (dot) => {
    const samples: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      samples.push(dot.getBoundingClientRect().y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return samples;
  });
  expect(Math.max(...reducedPositions) - Math.min(...reducedPositions)).toBeLessThan(0.1);
});

test("messages send through the real UI and fixture replies arrive over SSE", async ({ desk }) => {
  await resetAndOpen(desk, 1300, "light");
  const page = desk.page;
  await page.getByTestId("conversation-row").first().click();
  const composer = page.getByRole("textbox").last();
  const outbound = "Fixture outbound: doors confirmed at eight.";
  await composer.fill(outbound);
  await composer.press("Enter");
  await expect(page.getByText(outbound, { exact: true }).filter({ visible: true })).toHaveCount(1);

  const inbound = "Fixture inbound: perfect, see you there.";
  await desk.receive(desk.chats.needs, inbound, "+16195550101");
  await expect(page.getByText(inbound, { exact: true }).filter({ visible: true })).toHaveCount(1);
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
