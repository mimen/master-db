import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const INBOUND = "Can you send the final arrival time?";
// The repo's gitignored artifacts dir; the drive is staged into apps/imsg/e2e/fixture/.
const SHOTS = join(import.meta.dirname, "..", "..", "artifacts", "2026-10-07-reactions");

async function storedReactions(desk: { request: Page["request"]; chats: { needs: string } }): Promise<string[]> {
  const response = await desk.request.post("/__fixture/convex", {
    data: { name: "comma/queries:listMessages", args: { conversationId: desk.chats.needs, paginationOpts: { numItems: 50, cursor: null } } },
  });
  const { page: rows } = await response.json() as { page: Array<{ text: string; reactions: Array<{ type: string; isFromMe: boolean }> }> };
  return rows.find((row) => row.text === INBOUND)?.reactions.filter((r) => r.isFromMe).map((r) => r.type) ?? [];
}

test.use({ deviceScaleFactor: 2 });

for (const scheme of ["light", "dark"] as const) {
  test(`tray screenshots on desktop and phone (${scheme})`, async ({ desk }) => {
    const page = desk.page;
    mkdirSync(SHOTS, { recursive: true });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // A chosen tapback shows the accent fill in every shot.
    const react = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/outbox:enqueue", args: { conversationId: desk.chats.needs, clientKey: `shot-${scheme}`,
        payload: { kind: "react", messageGuid: "needs-2", reaction: "laugh", remove: false } } },
    });
    expect(react.ok()).toBe(true);

    await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });
    const bubble = page.getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
    await expect.poll(() => storedReactions(desk)).toEqual(["laugh"]);
    await bubble.click({ button: "right" });
    const tray = page.getByRole("toolbar", { name: "Tapbacks" });
    await expect(tray.getByRole("button", { name: "Remove Laugh" })).toBeVisible();
    await page.mouse.move(0, 0);
    const top = (await tray.boundingBox())!;
    const bottom = (await bubble.boundingBox())!;
    const y = Math.max(0, top.y - 40);
    await page.screenshot({ path: join(SHOTS, `desktop-${scheme}.png`), clip: { x: Math.max(0, bottom.x - 40), y, width: 640, height: bottom.y + bottom.height + 40 - y } });
    await page.screenshot({ path: join(SHOTS, `desktop-${scheme}-tray.png`), clip: await padded(tray) });
    await page.keyboard.press("Escape");
    await expect(tray).toHaveCount(0);

    // A long press on a wide window has no cursor anchor: the tray floats over a centered dialog.
    await longPress(page, bubble);
    await expect(tray.getByRole("button", { name: "Remove Laugh" })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(SHOTS, `dialog-${scheme}.png`) });
    await page.keyboard.press("Escape");
    await expect(tray).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await longPress(page, bubble);
    await expect(tray.getByRole("button", { name: "Remove Laugh" })).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `phone-${scheme}.png`) });
    await page.screenshot({ path: join(SHOTS, `phone-${scheme}-tray.png`), clip: await padded(tray) });
  });
}

async function padded(locator: ReturnType<Page["locator"]>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 };
}

async function longPress(page: Page, target: ReturnType<Page["locator"]>) {
  await target.hover();
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.up();
}
