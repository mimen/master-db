import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";

/** Every Convex call the client makes, by function name, with its args. */
function convexCalls(page: Page): { name: string; args: Record<string, unknown> }[] {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex") || request.method() !== "POST") return;
    const body = request.postDataJSON() as { name?: string; args?: Record<string, unknown> } | null;
    if (body?.name) calls.push({ name: body.name, args: body.args ?? {} });
  });
  return calls;
}

const THREAD = "Sam Lee, Load-in for Saturday";

async function openMail(page: Page) {
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: THREAD }).click();
  const reader = page.getByTestId("email-reader");
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  return reader;
}

test("B1: Mail answers the palette, help, Esc, j/k and ⌘E", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  await openMail(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } });

  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  await page.keyboard.press("Meta+/");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByText("⌘1–⌘7"), "help lists the lens chords").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await page.getByRole("tab", { name: /^All inbox/ }).click();
  await page.getByRole("button", { name: THREAD }).click();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("j");
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" }), "j moved to the next thread").toHaveCount(0);
  await page.keyboard.press("k");
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();

  await page.keyboard.press("Meta+e");
  await expect(page.getByText("Settled Sam Lee")).toBeVisible();
  await expect.poll(() => calls.filter((call) => call.name === "comma/triage:settle").map((call) => call.args.conversationId)).toEqual([fixtureConversationId("mail:t-venue")]);
});

test("B5: opening an email reads it in Comma, once", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  await openMail(page);
  await expect.poll(() => calls.filter((call) => call.name === "comma/triage:markRead").map((call) => call.args.conversationId)).toEqual([fixtureConversationId("mail:t-venue")]);
  await page.waitForTimeout(500);
  expect(calls.filter((call) => call.name === "comma/triage:markRead")).toHaveLength(1);
});

test("B16: a refused archive says so, and Mail's Archive answers with Undo", async ({ desk }) => {
  const page = desk.page;
  const reader = await openMail(page);
  await desk.request.post("/__fixture/mail", { data: { refuseNextArchive: "Google answered 403: PERMISSION_DENIED" } });
  await reader.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText(/Gmail didn't archive Sam Lee, so it's back in the inbox/)).toBeVisible();
  await expect(reader.getByRole("alert")).toHaveText("Gmail didn't archive this: Google answered 403: PERMISSION_DENIED");

  await reader.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("B23: switching to a lens that doesn't hold the open thread closes it", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^All inbox/ }).click();
  await page.getByRole("button", { name: /This week at the club/ }).click();
  await expect(page.getByTestId("email-reader")).toBeVisible();
  await page.getByRole("tab", { name: /^People/ }).click();
  await expect(page.getByTestId("email-reader")).toHaveCount(0);
  await expect(page.getByText("Select a thread")).toBeVisible();
});

test("B11: Esc closes the find bar, from its own field", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.keyboard.press("Meta+f");
  const find = page.getByPlaceholder("Search this conversation");
  await expect(find).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
});

test("B8: a link to a conversation that doesn't exist says so and reads nothing", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  await page.goto("/c/does-not-exist", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("This conversation isn't available")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("This conversation isn't available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back", exact: true }).last()).toBeVisible();
  expect(calls.filter((call) => call.name === "comma/triage:markRead")).toEqual([]);
});

test("B7: a thread opens on its unread divider, and each open reads it once", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  const NINA = "iMessage;-;+16195550201";
  const rows = page.getByTestId("conversation-row");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await rows.filter({ hasText: "Nina Park" }).click();
  await expect(page.getByTestId("thread-view").getByText("Any update when you get a chance?", { exact: true })).toBeVisible();
  await rows.filter({ hasText: "Alex Rivera" }).click();
  for (const text of ["One more thing", "The van is at 5", "Bring the rider", "And the cables"]) await desk.receive(NINA, text, "+16195550201");
  await rows.filter({ hasText: "And the cables" }).click();
  await expect(page.getByTestId("thread-view").getByText("4 unread", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  const reads = calls.filter((call) => call.name === "comma/triage:markRead").map((call) => call.args.conversationId);
  expect(reads).toEqual([fixtureConversationId(NINA), fixtureConversationId(desk.chats.needs), fixtureConversationId(NINA)]);
});

test("B24: sidebar search points at the matches only Mail lists", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Search conversations and messages").fill("load-in");
  await expect(page.getByRole("link", { name: /1 match in Mail/ })).toBeVisible();
});

test("B13: a quiet Slack channel is neither settled nor settleable", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seedChannel: true } });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Doors at 8" }).click();
  await expect(page.getByTestId("thread-view").first().getByText("Doors at 8, set times to follow")).toBeVisible();
  await expect(page.getByTestId("thread-settle")).toHaveCount(0);
  await expect(page.getByText(/texts again/)).toHaveCount(0);
});

test("B10: ⌘E in the palette on a command row settles nothing behind it", async ({ desk }) => {
  const page = desk.page;
  const calls = convexCalls(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("settings", { delay: 30 });
  await page.keyboard.press("Meta+e");
  await page.waitForTimeout(300);
  expect(calls.filter((call) => call.name === "comma/triage:settle")).toEqual([]);
});
