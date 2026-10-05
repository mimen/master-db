import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const NINA_ADDRESS = "+16195550201";
const NINA = `iMessage;-;${NINA_ADDRESS}`;

/** Holds every messages fetch for `chatGuid` until the returned release runs. */
async function holdThreadFetches(page: Page, chatGuid: string): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string; args: { conversationId?: string } };
    if (body.name !== "comma/queries:listMessages" || body.args.conversationId !== chatGuid) {
      return route.continue();
    }
    await gate;
    await route.continue();
  });
  return release;
}

for (const history of ["opened earlier", "never opened"] as const) {
  test(`a message seen in the sidebar is in the thread before its fetch lands: chat ${history}`, async ({ desk }) => {
    const page = desk.page;
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("conversation-row");
    const thread = page.getByTestId("thread-view");
    const nina = rows.filter({ hasText: "Nina Park" });
    if (history === "opened earlier") {
      await nina.click();
      await expect(thread.getByText("Any update when you get a chance?", { exact: true })).toBeVisible();
    }
    await rows.filter({ hasText: "Alex Rivera" }).click();
    await expect(thread.getByText("Can you send the final arrival time?", { exact: true })).toBeVisible();

    const inbound = `Production signed off (${history})`;
    await desk.receive(NINA, inbound, NINA_ADDRESS);
    await expect(nina).toContainText(inbound);

    const release = await holdThreadFetches(page, NINA);
    try {
      await nina.click();
      await expect(thread.getByText(inbound, { exact: true })).toBeVisible({ timeout: 3_000 });
      release();
      await expect(thread.getByText("Following up on Nina's plan.", { exact: true })).toBeVisible();
      await expect(thread.getByText(inbound, { exact: true })).toHaveCount(1);
    } finally {
      release();
    }
  });
}

test("Convex updates edit and retract a confirmed send without reviving its optimistic row", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // All, not Needs reply: a send there auto-advances away from the thread under test.
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("A live query send");
  await composer.press("Enter");
  await expect(thread.getByText("A live query send", { exact: true })).toHaveCount(1);
  let guid = "";
  await expect.poll(async () => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId: desk.chats.needs, paginationOpts: { numItems: 100, cursor: null } } },
    });
    const { page: messages } = await response.json() as { page: Array<{ guid: string; text: string }> };
    guid = messages.find((message) => message.text === "A live query send")?.guid ?? "";
    return guid;
  }).toMatch(/^out-/);
  const command = async (payload: { kind: string; messageGuid: string; text?: string; reaction?: string; remove?: boolean }) => {
    const result = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/outbox:enqueue", args: { conversationId: desk.chats.needs,
        clientKey: `live-${payload.kind}`, payload } },
    });
    expect(result.ok()).toBe(true);
  };
  await command({ kind: "edit", messageGuid: guid, text: "Edited in Convex" });
  await expect(thread.getByText("Edited in Convex", { exact: true })).toHaveCount(1);
  await expect(thread.getByText("A live query send", { exact: true })).toHaveCount(0);
  await command({ kind: "react", messageGuid: guid, reaction: "like", remove: false });
  await expect(thread.getByText("👍", { exact: true })).toBeVisible();
  await command({ kind: "unsend", messageGuid: guid });
  await expect(thread.getByText("Edited in Convex", { exact: true })).toHaveCount(0);
  await expect(thread.getByText("A live query send", { exact: true })).toHaveCount(0);
});
