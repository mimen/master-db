import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const INBOUND = "Can you send the final arrival time?";

function reactCommands(page: Page): unknown[] {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "react") sent.push(body.args.payload);
  });
  return sent;
}

async function storedReactions(desk: { request: Page["request"]; chats: { needs: string } }): Promise<string[]> {
  const response = await desk.request.post("/__fixture/convex", {
    data: { name: "comma/queries:listMessages", args: { conversationId: desk.chats.needs, paginationOpts: { numItems: 50, cursor: null } } },
  });
  const { page: rows } = await response.json() as { page: Array<{ text: string; reactions: Array<{ type: string; isFromMe: boolean }> }> };
  return rows.find((row) => row.text === INBOUND)?.reactions.filter((r) => r.isFromMe).map((r) => r.type) ?? [];
}

test("desktop: right-click opens the tray, the keyboard picks Like, and the reaction lands", async ({ desk }) => {
  const page = desk.page;
  const sent = reactCommands(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const bubble = page.getByTestId("thread-view").getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
  await bubble.click({ button: "right" });

  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  await expect(tray.getByRole("button")).toHaveText(["", "", "", "", "", ""]);
  await expect(tray.getByRole("button", { name: "Love", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tray.getByRole("button", { name: "Like", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tray).toHaveCount(0);

  await expect(page.getByTestId("thread-view").getByRole("button", { name: "Like", exact: true })).toBeVisible();
  expect(sent).toEqual([expect.objectContaining({ kind: "react", reaction: "like", remove: false })]);
  await expect.poll(() => storedReactions(desk)).toEqual(["like"]);

  // Reopened, the chosen tapback is marked and offers removal; Escape closes without sending.
  await bubble.click({ button: "right" });
  await expect(tray.getByRole("button", { name: "Remove Like" })).toHaveAttribute("aria-selected", "true");
  await expect(tray.getByRole("button", { name: "Remove Like" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tray).toHaveCount(0);
  expect(sent).toHaveLength(1);
});

test("phone: a long press opens the touch tray and a tap on Love lands", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  const sent = reactCommands(page);
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}?name=Alex%20Rivera`, { waitUntil: "domcontentloaded" });
  const bubble = page.getByRole("button", { name: `Alex Rivera: ${INBOUND}` });
  await bubble.hover();
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.up();

  const tray = page.getByRole("toolbar", { name: "Tapbacks" });
  await tray.getByRole("button", { name: "Love", exact: true }).click();
  await expect(tray).toHaveCount(0);
  expect(sent).toEqual([expect.objectContaining({ kind: "react", reaction: "love", remove: false })]);
  await expect.poll(() => storedReactions(desk)).toEqual(["love"]);
});
