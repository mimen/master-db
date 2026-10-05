import { mkdirSync } from "node:fs";

import { expect, test } from "../fixtures/desk";

const OUT = process.env.COMMA_GALLERY_DIR ?? "/tmp/comma-toast-fix2/after";
const sizes = [
  { name: "desktop", width: 1300, height: 820 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-short", width: 390, height: 500 },
] as const;

for (const scheme of ["light", "dark"] as const) {
  for (const size of sizes) {
    test(`toast leaves messages readable in ${scheme} ${size.name}`, async ({ desk }) => {
      mkdirSync(OUT, { recursive: true });
      const page = desk.page;
      await page.setViewportSize({ width: 1300, height: 820 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: "All", exact: true }).click();
      const rows = page.getByTestId("conversation-row");
      await expect(rows.first()).toBeVisible();
      const before = await rows.count();
      const lastMessage = page.getByText("I added the revised run of show.", { exact: true });
      await expect(lastMessage).toBeVisible();
      await page.getByTestId("thread-settle").click();
      const undo = page.getByRole("button", { name: "Undo", exact: true });
      await expect(undo).toBeVisible();
      await page.setViewportSize({ width: size.width, height: size.height });
      await expect(lastMessage).toBeVisible();
      await expect(undo.locator("..")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: `${OUT}/toast-${scheme}-${size.name}.png`, animations: "disabled" });
      const pill = await undo.locator("..").boundingBox();
      const message = await lastMessage.boundingBox();
      expect(pill).not.toBeNull();
      expect(message).not.toBeNull();
      if (!pill || !message) throw new Error("Toast or message has no layout");
      const overlaps = pill.x < message.x + message.width && pill.x + pill.width > message.x
        && pill.y < message.y + message.height && pill.y + pill.height > message.y;
      expect(overlaps, "toast must not cover the last message").toBe(false);
      expect(pill.y + pill.height).toBeLessThanOrEqual(size.height);
      const status = page.getByRole("status").filter({ hasText: "Settled" });
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).toHaveCSS("background-color", scheme === "light" ? "rgb(23, 23, 26)" : "rgb(237, 237, 239)");
      await expect(status.getByText(/^Settled /)).toHaveCSS("color", scheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 26)");
      await expect(status).toContainText("⌘Z");
      const list = page.getByTestId("thread-message-list");
      const chrome = await page.getByTestId("thread-composer-chrome").boundingBox();
      const listWithToast = await list.boundingBox();
      if (!chrome || !listWithToast) throw new Error("Thread has no layout");
      expect(pill.x + pill.width / 2, "toast is centered within the thread").toBeCloseTo(chrome.x + chrome.width / 2, 1);
      expect(pill.y, "toast stays below the entire message list").toBeGreaterThanOrEqual(listWithToast.y + listWithToast.height);
      expect(pill.y).toBeGreaterThanOrEqual(chrome.y);
      const chips = await page.getByText("what time do you need the final answer by?", { exact: true }).boundingBox();
      if (chips) expect(pill.y, "toast clears the suggestion chips").toBeGreaterThanOrEqual(chips.y + chips.height);
      expect(pill.y + pill.height).toBeLessThanOrEqual(chrome.y + chrome.height);
      await undo.click();
      await expect(undo).toHaveCount(0);
      expect(await list.boundingBox(), "message list does not move when toast disappears").toEqual(listWithToast);
      if (size.name === "desktop") await expect(rows).toHaveCount(before);
    });
  }
}

test("toast does not reflow the message list or sidebar", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByText("what time do you need the final answer by?", { exact: true })).toBeVisible();
  const regions = [
    page.getByTestId("thread-message-list"),
    page.getByLabel("Resize sidebar").filter({ visible: true }).locator(".."),
  ];
  const before = await Promise.all(regions.map((region) => region.boundingBox()));
  for (const box of before) expect(box).not.toBeNull();
  await page.getByTestId("thread-settle").click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  expect(await Promise.all(regions.map((region) => region.boundingBox()))).toEqual(before);
  await undo.click();
  await expect(undo).toHaveCount(0);
  expect(await Promise.all(regions.map((region) => region.boundingBox()))).toEqual(before);
});

for (const scheme of ["light", "dark"] as const) {
  test(`toast without an open thread floats at the window bottom in ${scheme}`, async ({ desk }) => {
    mkdirSync(OUT, { recursive: true });
    const page = desk.page;
    await page.setViewportSize({ width: 1300, height: 820 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Select a conversation", { exact: true })).toBeVisible();
    const sidebar = page.getByLabel("Resize sidebar").filter({ visible: true }).locator("..");
    const before = await sidebar.boundingBox();
    await page.keyboard.press("Meta+e");
    const status = page.getByRole("status").filter({ hasText: "Select a conversation first" });
    await expect(status).toBeVisible();
    await expect(status).toHaveCSS("opacity", "1");
    const pill = await status.boundingBox();
    if (!pill) throw new Error("Toast has no layout");
    expect(pill.x + pill.width / 2).toBeCloseTo(650, 1);
    expect(pill.y + pill.height).toBe(812);
    expect(await sidebar.boundingBox()).toEqual(before);
    await page.screenshot({ path: `${OUT}/toast-${scheme}-no-thread.png`, animations: "disabled" });
    await expect(status).toHaveCount(0);
    expect(await sidebar.boundingBox()).toEqual(before);
  });
}

test("toast stays visible when the selected thread's workspace is hidden", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("thread-settle").click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(undo).toBeVisible();
  const status = page.getByRole("status").filter({ hasText: "Settled" });
  await expect(status).toHaveCSS("opacity", "1");
  const pill = await status.boundingBox();
  if (!pill) throw new Error("Toast has no layout");
  expect(pill.x + pill.width / 2).toBeCloseTo(650, 1);
  expect(pill.y + pill.height).toBe(812);
  await undo.click();
  await expect(undo).toHaveCount(0);
});

test("action toast keeps Undo available for five seconds", async ({ desk }) => {
  const page = desk.page;
  await page.clock.install();
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.getByText("I added the revised run of show.", { exact: true })).toBeVisible();
  await page.getByTestId("thread-settle").click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await page.clock.fastForward(4500);
  await expect(undo).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(undo).toHaveCount(0);
});
