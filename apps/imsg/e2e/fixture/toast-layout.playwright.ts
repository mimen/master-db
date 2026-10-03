import { mkdirSync } from "node:fs";

import { expect, test } from "../fixtures/desk";

const OUT = process.env.COMMA_GALLERY_DIR ?? "/tmp/comma-toast-fix/after";
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
      await page.getByRole("radio", { name: /^All,/ }).click();
      const rows = page.getByTestId("conversation-row");
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
      const status = page.getByRole("status");
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).toHaveCSS("background-color", scheme === "light" ? "rgb(26, 26, 28)" : "rgb(255, 255, 255)");
      await expect(page.getByText("Settled", { exact: true })).toHaveCSS("color", scheme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
      const thread = await page.getByTestId("thread-view").boundingBox();
      if (!thread) throw new Error("Thread has no layout");
      expect(thread.y + thread.height, "toast has its own space outside the thread").toBeLessThanOrEqual(pill.y);
      await undo.click();
      await expect(undo).toHaveCount(0);
      if (size.name === "desktop") await expect(rows).toHaveCount(before);
    });
  }
}

test("action toast keeps Undo available for five seconds", async ({ desk }) => {
  const page = desk.page;
  await page.clock.install();
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}?name=Launch%20Crew&isGroup=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("radio", { name: /^All,/ }).click();
  await expect(page.getByText("I added the revised run of show.", { exact: true })).toBeVisible();
  await page.getByTestId("thread-settle").click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await page.clock.fastForward(4500);
  await expect(undo).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(undo).toHaveCount(0);
});
