import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;

function captureCommands(page: Page): string[] {
  const kinds: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name?: string; args?: { payload?: { kind?: string } } } | null;
    if (body?.name === "comma/outbox:enqueue" && body.args?.payload?.kind) kinds.push(body.args.payload.kind);
  });
  return kinds;
}

async function open(page: Page, width: number, height: number, scheme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
}

async function needsCount(page: Page): Promise<number> {
  const label = await page.getByRole("tab", { name: /^Needs reply, \d+/ }).getAttribute("aria-label");
  return Number(/(\d+)/.exec(label ?? "")?.[1]);
}

const heading = (page: Page) => page.getByTestId("thread-view").getByRole("heading", { level: 2 });

test("settle-loop: strip, ⌘E settle with toast and undo, auto-advance, position", async ({ desk }) => {
  const page = desk.page;
  const kinds = captureCommands(page);
  await open(page, 1440, 900, "light");
  const rows = page.getByTestId("conversation-row");
  const before = await needsCount(page);
  await rows.first().click();
  const first = (await heading(page).textContent())!;
  const strip = page.getByTestId("state-strip");
  await expect(strip).toContainText(/Your turn for \d+[mhdw]/);
  await expect(strip.getByRole("button", { name: "Settle (⌘E)" })).toBeVisible();
  await expect(page.getByText(new RegExp(`^1 of ${before}$`))).toBeVisible();
  await page.mouse.move(900, 300);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "desk-main.png") });

  // ⌘E from the composer: settles, toasts with the name, and advances with no hold.
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+e");
  await expect(page.getByText(`Settled ${first}`, { exact: true })).toBeVisible();
  await expect(heading(page)).not.toHaveText(first);
  await expect.poll(() => needsCount(page)).toBe(before - 1);
  await expect(page.getByText(new RegExp(`^1 of ${before - 1}$`))).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("placeholder"))).toBe("iMessage");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, "desk-settled-toast.png") });
  writeFileSync(join(evidence, "aria.txt"), await page.getByTestId("thread-view").ariaSnapshot());

  // ⌘Z outside a text field undoes; the conversation returns to Needs reply.
  await page.mouse.click(900, 300);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Meta+z");
  await expect.poll(() => needsCount(page)).toBe(before);
  expect(kinds.filter((kind) => kind === "settle" || kind === "unsettle")).toEqual(["settle", "unsettle"]);

  // J/K buttons step through the queue.
  const position = page.getByText(new RegExp(`^\\d+ of ${before}$`));
  const at = Number((await position.textContent())!.split(" ")[0]);
  await page.getByRole("button", { name: "Next conversation (J)" }).click();
  await expect(page.getByText(`${at + 1} of ${before}`, { exact: true })).toBeVisible();

  // Send from Needs reply stays on the conversation; only a settle moves on.
  const sender = (await heading(page).textContent())!;
  await page.getByPlaceholder("iMessage").fill("On it");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForTimeout(2000);
  await expect(heading(page)).toHaveText(sender);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("placeholder"))).toBe("iMessage");
});

test("settle-loop: settled strip offers un-settle (dark)", async ({ desk }) => {
  const page = desk.page;
  await open(page, 1440, 900, "dark");
  await page.getByRole("tab", { name: "All", exact: true }).click();
  const rows = page.getByTestId("conversation-row");
  await rows.first().click();
  const strip = page.getByTestId("state-strip");
  await expect(strip).toBeVisible();
  if (await strip.getByRole("button", { name: "Settle (⌘E)" }).isVisible()) await page.keyboard.press("Meta+e");
  await expect(strip).toContainText("Settled");
  await expect(strip).toContainText(/Back in Needs reply if .+ texts again/);
  await expect(strip.getByRole("button", { name: "Un-settle (⌘E)" })).toBeVisible();
  await page.waitForTimeout(5600);
  await page.mouse.move(900, 300);
  await page.screenshot({ path: join(evidence, "desk-settled-dark.png") });
});

test("settle-loop: phone strip", async ({ desk }) => {
  const page = desk.page;
  await open(page, 390, 844, "light");
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByTestId("state-strip")).toContainText(/Your turn for/);
  await expect(page.getByText(/^\d+ of \d+$/)).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "phone-thread.png") });
});
