import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
// The slowest reply-suggestions call measured on real threads through the Mini's gateway.
const SLOW_MODEL_MS = 10_300;
const STUCK_MODEL_MS = 45_000;
const SHELF_TEXT = "what time works?";

type Enqueue = { at: number; clientKey: string; refresh: boolean; doneAt?: number; outcome?: string };

test("suggestions-deadline: a 10.3s model call lands a shelf, and a stuck one ends as a timeout with Retry", async ({ desk }) => {
  test.setTimeout(150_000);
  const page = desk.page;
  const start = Date.now();
  const suggestions: Enqueue[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: { clientKey?: string; payload?: { kind: string; refresh?: boolean } } };
    if (body.name !== "comma/outbox:enqueue" || body.args.payload?.kind !== "suggestions") return;
    const row: Enqueue = { at: Date.now() - start, clientKey: body.args.clientKey!, refresh: body.args.payload.refresh === true };
    suggestions.push(row);
    void request.response().then(async (response) => {
      row.doneAt = Date.now() - start;
      row.outcome = response ? `${response.status()} ${await response.text()}` : "no response";
    });
  });
  const settled = (index: number) => async () => suggestions[index]?.outcome ?? "pending";
  const ghost = page.getByTestId("composer-ghost");
  const retry = page.getByRole("button", { name: "Retry suggestions" });

  await desk.request.post("/__fixture/model", { data: { delayMs: SLOW_MODEL_MS } });
  // A new inbound message moves the anchor past the seeded cache, so the open runs the model.
  await desk.receive(desk.chats.needs, "are you still good for saturday?");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await expect.poll(() => suggestions.length).toBe(1);
  await page.screenshot({ path: join(evidence, "1-slow-model-loading.png") });
  await expect.poll(settled(0), { timeout: SLOW_MODEL_MS + 15_000 }).not.toBe("pending");
  expect(suggestions[0]!.outcome, "a 10.3s model call completes").toMatch(/^200 /);
  await expect(ghost).toHaveText(SHELF_TEXT);
  await expect(retry).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "2-slow-model-shelf.png") });

  await desk.request.post("/__fixture/model", { data: { delayMs: STUCK_MODEL_MS } });
  await desk.receive(desk.chats.needs, "also can you bring the speaker");
  await expect.poll(() => suggestions.length, { timeout: 10_000 }).toBe(2);
  await expect.poll(settled(1), { timeout: STUCK_MODEL_MS + 15_000 }).not.toBe("pending");
  const stuck = suggestions[1]!;
  expect(stuck.outcome, "a stuck model call ends at the deadline as a timeout").toContain("model timed out after 30s");
  expect(stuck.doneAt! - stuck.at, "the deadline cut the call before the model answered").toBeLessThan(STUCK_MODEL_MS);
  await expect(retry).toBeVisible();
  await page.screenshot({ path: join(evidence, "3-stuck-model-retry.png") });
  writeFileSync(join(evidence, "aria-retry.txt"), await page.getByTestId("thread-view").ariaSnapshot());

  await desk.request.post("/__fixture/model", { data: { delayMs: 0 } });
  await retry.click();
  await expect.poll(() => suggestions.length).toBe(3);
  await expect.poll(settled(2), { timeout: 15_000 }).toMatch(/^200 /);
  expect(suggestions[2]!.refresh, "Retry forces a fresh generation").toBe(true);
  await expect(ghost).toHaveText(SHELF_TEXT);
  await page.screenshot({ path: join(evidence, "4-retry-shelf.png") });
  writeFileSync(join(evidence, "aria.txt"), await page.getByTestId("thread-view").ariaSnapshot());
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ slowModelMs: SLOW_MODEL_MS, stuckModelMs: STUCK_MODEL_MS, suggestions }, null, 2));
});
