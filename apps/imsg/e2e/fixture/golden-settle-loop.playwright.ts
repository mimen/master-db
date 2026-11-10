import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test, openView, viewCount } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";
import { pendingGuid } from "../../shared/pending-send";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-golden-"));

function captureCommands(page: Page): string[] {
  const kinds: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name?: string; args?: { payload?: { kind?: string } } } | null;
    const triage = /^comma\/triage:(\w+)$/.exec(body?.name ?? "")?.[1];
    if (triage) kinds.push(triage);
    else if (body?.name === "comma/outbox:enqueue" && body.args?.payload?.kind) kinds.push(body.args.payload.kind);
  });
  return kinds;
}

async function open(page: Page, width: number, height: number, scheme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
}

const needsCount = (page: Page) => viewCount(page, "To review");

const heading = (page: Page) => page.getByTestId("thread-view").getByRole("heading", { level: 2 });

test("settle-loop: strip, ⌘E settle with toast and undo, auto-advance, position", async ({ desk }) => {
  const page = desk.page;
  const kinds = captureCommands(page);
  await open(page, 1440, 900, "light");
  // The app opens on Today; this loop is To review's.
  await openView(page, "To review");
  const rows = page.getByTestId("conversation-row");
  const before = await needsCount(page);
  await rows.first().click();
  const first = (await heading(page).textContent())!;
  const strip = page.getByTestId("state-strip");
  await expect(strip).toContainText(/Your turn · \d+[mhdw]/);
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

  // ⌘Z outside a text field undoes; the conversation returns to To review.
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

  // Send from To review stays on the conversation; only a settle moves on.
  const sender = (await heading(page).textContent())!;
  await page.getByPlaceholder("iMessage").fill("On it");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForTimeout(2000);
  await expect(heading(page)).toHaveText(sender);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("placeholder"))).toBe("iMessage");
});

test("settle-loop: ⌘E right after a send anchors on that send, and the conversation stays settled once it lands", async ({ desk }) => {
  const page = desk.page;
  const anchors: Array<string | undefined> = [];
  const sends: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name?: string; args?: { anchor?: string; clientKey?: string; payload?: { kind?: string } } } | null;
    if (body?.name === "comma/triage:settle") anchors.push(body.args?.anchor);
    if (body?.name === "comma/outbox:enqueue" && body.args?.payload?.kind === "send") sends.push(String(body.args.clientKey));
  });
  await desk.request.post("/__fixture/send-timing", { data: { delayMs: 1500, echo: false } });
  await open(page, 1440, 900, "light");
  await openView(page, "To review");
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("Settling right after this");
  await composer.press("Enter");
  await page.keyboard.press("Meta+e");
  await expect(page.getByText("Settled Alex Rivera", { exact: true })).toBeVisible();
  expect(sends).toHaveLength(1);
  expect(anchors).toEqual([pendingGuid(sends[0]!)]);

  const conversationId = fixtureConversationId(desk.chats.needs);
  const read = async (name: string, args: Record<string, unknown>) => (await (await desk.request.post("/__fixture/convex", { data: { name, args } })).json()) as { page: Array<Record<string, unknown>> };
  await expect.poll(async () => (await read("comma/queries:listMessages", { conversationId, paginationOpts: { numItems: 20, cursor: null } }))
    .page.find((row) => row.text === "Settling right after this")?.guid).toMatch(/^out-/);
  const alex = async () => (await read("comma/queries:listConversations", { paginationOpts: { numItems: 50, cursor: null } })).page.find((row) => row._id === conversationId);
  await expect.poll(async () => (await alex())?.flags).toMatchObject({ waiting: false, unresponded: false });
  await page.screenshot({ path: join(evidence, "anchor-after-send.png") });
});

test("settle-loop: settled strip offers un-settle (dark)", async ({ desk }) => {
  const page = desk.page;
  await open(page, 1440, 900, "dark");
  await openView(page, "All");
  const rows = page.getByTestId("conversation-row");
  await rows.first().click();
  const strip = page.getByTestId("state-strip");
  await expect(strip).toBeVisible();
  if (await strip.getByRole("button", { name: "Settle (⌘E)" }).isVisible()) await page.keyboard.press("Meta+e");
  await expect(strip).toContainText("Settled");
  // What brings it back is the lead's tooltip, not more words on the line.
  await expect(strip.getByTestId("strip-lead")).toHaveAttribute("title", /Back in To review if .+ texts again/);
  await expect(strip.getByRole("button", { name: "Un-settle (⌘E)" })).toBeVisible();
  await page.waitForTimeout(5600);
  await page.mouse.move(900, 300);
  await page.screenshot({ path: join(evidence, "desk-settled-dark.png") });
});

test("settle-loop: phone strip", async ({ desk }) => {
  const page = desk.page;
  await open(page, 390, 844, "light");
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByTestId("state-strip")).toContainText(/Your turn ·/);
  await expect(page.getByText(/^\d+ of \d+$/)).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "phone-thread.png") });
});
