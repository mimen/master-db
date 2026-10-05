import { mkdirSync } from "node:fs";
import { expect, test } from "../fixtures/desk";

const OUT = process.env.SIGNAL_WIRE_OUT ?? "/tmp/signal-wire";
mkdirSync(OUT, { recursive: true });

for (const scheme of ["light", "dark"] as const) {
  test(`signal-wire desk ${scheme}`, async ({ desk }) => {
    const page = desk.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("radio", { name: /^All,/ }).click();
    await expect(page.getByTestId("state-strip")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await page.getByPlaceholder("iMessage").fill("On it");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await page.getByPlaceholder("iMessage").fill("");
    await page.screenshot({ path: `${OUT}/desk-main-${scheme}.png` });

    await page.getByTestId("thread-settle").click();
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Settled" })).toContainText("⌘Z");
    await expect(page.getByTestId("state-strip")).toContainText("Settled");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/desk-settled-toast-${scheme}.png` });
    await undo.click();

    await page.getByRole("button", { name: "Settings" }).click();
    const pane = page.locator('[data-testid="desktop-utility-pane-content"]:visible');
    await expect(pane).toHaveCount(1);
    const box = await pane.boundingBox();
    expect(box?.width).toBe(640);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/desk-settings-${scheme}.png` });
    await page.getByLabel(/Close settings/i).first().click();

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/desk-palette-${scheme}.png` });
  });
}

test("signal-wire empty Needs reply lens", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const rows = page.getByTestId("conversation-row");
  await expect(rows.first()).toBeVisible();
  // Settle every row in Needs reply; each leaving row collapses out.
  test.setTimeout(120_000);
  const empty = page.getByRole("heading", { name: "You've replied to everyone" });
  for (let i = 0; i < 40 && !(await page.getByRole("radio", { name: /^Needs reply, 0 / }).count()); i++) {
    const before = await page.getByRole("radio", { name: /^Needs reply/ }).getAttribute("aria-label");
    await rows.first().click();
    await page.getByRole("button", { name: /^Settle \(/ }).click();
    await expect(page.getByRole("radio", { name: /^Needs reply/ })).not.toHaveAttribute("aria-label", before ?? "");
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole("heading", { name: "You've replied to everyone" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/desk-empty-light.png` });
  const nudge = page.getByRole("button", { name: /^Nudge / }).first();
  if (await nudge.count()) {
    await nudge.click();
    await expect(page.getByPlaceholder(/iMessage|Text Message/)).toBeFocused();
  }
});

test("signal-wire message menu", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
  const bubble = page.getByText("Deck is in the shared folder.", { exact: true });
  await expect(bubble).toBeVisible();
  await bubble.click({ button: "right" });
  await expect(page.getByText("Delete for Me", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT}/desk-menu-light.png` });
});

test("signal-wire phone", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /Messages, \d+ need a reply/ })).toBeVisible();
  await page.screenshot({ path: `${OUT}/phone-list.png` });
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByTestId("state-strip")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/phone-thread.png` });
});
