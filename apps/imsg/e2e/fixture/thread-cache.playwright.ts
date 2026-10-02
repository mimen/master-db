import type { Message } from "../../shared/types";
import { expect, test } from "../fixtures/desk";

test("hover dwell cancels, caps speculative fetches, and never caps an open", async ({ desk }) => {
  const page = desk.page;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests: string[] = [];
  await page.route("**/api/chats/*/messages*", async (route) => {
    requests.push(route.request().url());
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("conversation-row");
    await expect(rows.nth(3)).toBeVisible();
    await rows.nth(0).dispatchEvent("mouseenter");
    await page.waitForTimeout(60);
    expect(requests).toHaveLength(0);
    await rows.nth(0).dispatchEvent("mouseleave");
    await page.waitForTimeout(180);
    expect(requests).toHaveLength(0);

    for (const index of [0, 1, 2]) {
      await rows.nth(index).dispatchEvent("mouseenter");
      await page.waitForTimeout(180);
      await rows.nth(index).dispatchEvent("mouseleave");
    }
    expect(requests).toHaveLength(2);
    await rows.nth(3).click();
    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(3);
    const beforeRelease = requests.length;
    release();
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(beforeRelease);
    await rows.nth(2).dispatchEvent("mouseenter");
    await expect.poll(() => requests.length).toBe(beforeRelease + 1);
    await rows.nth(2).dispatchEvent("mouseleave");
    await expect(page.getByTestId("thread-view")).toBeVisible();
  } finally {
    release();
  }
});

test("a reload renders the persisted thread before its network refresh", async ({ desk }) => {
  const page = desk.page;
  const response = await desk.request.get(`/api/chats/${encodeURIComponent(desk.chats.needs)}/messages`);
  const batch = await response.json() as Message[];
  const text = batch[0]!.text;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" });
  await row.click();
  await expect(page.getByTestId("thread-view").getByText(text, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("imsg.threadCache.v1"))).toContain(desk.chats.needs);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route("**/api/chats/*/messages*", async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ json: batch.map((message, index) => index === 0 ? { ...message, text: "Refreshed thread from the network" } : message) });
  });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await row.click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("thread-view").getByText(text, { exact: true })).toBeVisible();
    release();
    await expect(page.getByTestId("thread-view").getByText("Refreshed thread from the network", { exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/imsg-thread-cache-reload.png" });
  } finally {
    release();
  }
});
