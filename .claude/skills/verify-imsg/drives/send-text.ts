import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const text = "verify-imsg send-text probe";

test("send-text: a typed message goes out through the Convex outbox and stays in the thread", async ({ desk }) => {
  const page = desk.page;
  const enqueued: unknown[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "send") enqueued.push(body.args.payload);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  await expect(thread).toBeVisible();
  await page.screenshot({ path: join(evidence, "1-before.png") });

  const composer = page.getByPlaceholder("iMessage");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(thread.getByText(text, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveValue("");

  // Side effect: the bridge-facing record, read back through the same Convex query the client uses.
  let stored: { guid: string; text: string; isFromMe: boolean } | undefined;
  await expect.poll(async () => {
    const response = await desk.request.post("/__fixture/convex", {
      data: { name: "comma/queries:listMessages", args: { conversationId: desk.chats.needs, paginationOpts: { numItems: 50, cursor: null } } },
    });
    const { page: rows } = await response.json() as { page: Array<{ guid: string; text: string; isFromMe: boolean }> };
    stored = rows.find((row) => row.text === text);
    return stored?.guid ?? "";
  }).toMatch(/^out-/);

  // The bubble fades in; capture it once settled so the screenshot shows the real end state.
  const bubble = thread.getByText(text, { exact: true });
  const opacity = () => bubble.evaluate((node) => {
    let value = 1;
    for (let el: Element | null = node; el; el = el.parentElement) value *= Number(getComputedStyle(el).opacity);
    return Math.round(value * 100) / 100;
  });
  await expect.poll(opacity, { timeout: 5_000 }).toBe(1);
  await page.screenshot({ path: join(evidence, "2-after.png") });
  writeFileSync(join(evidence, "aria.txt"), await thread.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ enqueued, stored }, null, 2));
  expect(enqueued).toEqual([expect.objectContaining({ kind: "send", text })]);
  expect(stored).toMatchObject({ text, isFromMe: true });
});
