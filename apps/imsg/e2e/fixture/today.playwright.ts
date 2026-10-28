import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

async function todayCount(page: Page): Promise<number> {
  const label = await page.getByRole("tab", { name: /^Today, \d+/ }).getAttribute("aria-label");
  return Number(/(\d+)/.exec(label ?? "")?.[1]);
}

async function openToday(page: Page): Promise<void> {
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

const heading = (page: Page) => page.getByTestId("thread-view").getByRole("heading", { level: 2 });
const composerFocused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("placeholder"));

test("the app opens on Today; a settle leaves a rank gap and moves progress; Update folds New since into the groups", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  await expect(page.getByRole("tab", { name: /^Today, \d+/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("today-meta")).toHaveText("Updated 10:30 AM · session from Aug 19 · Opus 5.5 · read 15 of 21 threads");
  await expect(page.getByText("New since 10:30 AM", { exact: true })).toBeVisible();
  const rows = page.getByTestId("conversation-row");
  const alex = rows.filter({ hasText: "Alex Rivera" });
  await expect(alex.getByTestId("today-reason")).toHaveText("The final arrival time unblocks the run of show.");
  await expect(page.getByTestId("today-progress")).toHaveText("0 settled · 13 to go");

  await rows.filter({ hasText: "Priya Shah" }).click();
  await expect(page.getByTestId("strip-today")).toHaveText("#2 todayGuest list locks at 6 PM.");
  await page.getByTestId("thread-settle").click();
  await expect.poll(() => todayCount(page)).toBe(12);
  await expect(page.getByTestId("today-progress")).toHaveText("1 settled · 12 to go");
  await alex.click();
  await expect(rows.filter({ hasText: "Priya Shah" })).toHaveCount(0);
  expect((await page.getByTestId("today-rank").allTextContents()).slice(0, 3)).toEqual(["", "1", "3"]);

  await page.getByTestId("today-update").click();
  await expect(page.getByTestId("today-update")).toHaveText("Updating");
  await expect(page.getByTestId("today-meta")).toHaveText("Checking what changed with Opus 5.5…");
  await expect(page.getByTestId("today-build-menu")).toBeDisabled();
  await expect(page.getByTestId("today-update")).toHaveText("Update", { timeout: 10_000 });
  await expect(page.getByTestId("today-meta")).toHaveText(/^Updated \d+:\d\d [AP]M · session from Aug 19 · Opus 5\.5 · read \d+ of \d+ threads$/);
  await expect(page.getByText("New since 10:30 AM", { exact: true })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Launch Crew" }).getByTestId("today-rank")).toHaveText("1");
  await expect(page.getByTestId("today-progress")).toHaveText("1 settled · 13 to go");
});

test("Regenerate from scratch is one menu away and starts a new session", async ({ desk }) => {
  const { page } = desk;
  const builds: unknown[] = [];
  page.on("request", (req) => {
    if (!req.url().endsWith("/__fixture/convex")) return;
    const body = req.postDataJSON() as { name?: string; args?: { mode?: string } } | null;
    if (body?.name === "comma/today:requestBuild") builds.push(body.args?.mode);
  });
  await openToday(page);
  await page.getByTestId("today-build-menu").click();
  const regenerate = page.getByRole("menuitem", { name: "Regenerate from scratch" });
  await expect(regenerate).toBeVisible();
  await expect(page.getByText("New session: rereads the inbox and re-ranks everything", { exact: true })).toBeVisible();
  await regenerate.click();
  await expect(page.getByTestId("today-update")).toHaveText("Regenerating");
  await expect(page.getByTestId("today-meta")).toHaveText("Reading threads with Opus 5.5…");
  await expect(page.getByTestId("today-update")).toHaveText("Update", { timeout: 10_000 });
  await expect(page.getByTestId("today-meta")).toHaveText(/^Built \d+:\d\d [AP]M · Opus 5\.5 · read \d+ of \d+ threads$/);
  expect(builds).toEqual(["fresh"]);
});

test("Settle all settles the settle group as one action, and one Undo brings every row back", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  await expect(page.getByText("Just settle these", { exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Taylor Morgan" }).getByTestId("today-reason")).toHaveText("No reply needed: a tapback closed it.");
  const before = await todayCount(page);
  await page.getByTestId("today-settle-all").click();
  await expect(page.getByText("Settled 2 threads", { exact: true })).toBeVisible();
  await expect.poll(() => todayCount(page)).toBe(before - 2);
  await expect(page.getByText("Just settle these", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("today-progress")).toHaveText(`2 settled · ${before - 2} to go`);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => todayCount(page)).toBe(before);
  await expect(page.getByText("Just settle these", { exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Taylor Morgan" })).toBeVisible();
  await expect(rows.filter({ hasText: "Sofia Martinez" })).toBeVisible();
  await expect(page.getByTestId("today-progress")).toHaveText(`0 settled · ${before} to go`);
});

const TAYLOR = "iMessage;-;+16195550204";
const SOFIA = "iMessage;-;+16195550209";
type ConvexCall = { name?: string; args?: { conversationId?: string; payload?: { kind?: string; messageGuid?: string } } };

function outboxLog(page: Page): { conversationId?: string; kind?: string; messageGuid?: string }[] {
  const log: { conversationId?: string; kind?: string; messageGuid?: string }[] = [];
  page.on("request", (req) => {
    if (!req.url().endsWith("/__fixture/convex")) return;
    const body = req.postDataJSON() as ConvexCall | null;
    if (body?.name === "comma/outbox:enqueue") log.push({ conversationId: body.args?.conversationId, ...body.args?.payload });
  });
  return log;
}

test("a settle-group thread that gets a new message after the build moves to New since, and Settle all leaves it alone", async ({ desk }) => {
  const { page } = desk;
  const outbox = outboxLog(page);
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  const taylor = rows.filter({ hasText: "Taylor Morgan" });
  await expect(taylor.getByTestId("today-reason")).toHaveText("No reply needed: a tapback closed it.");

  await desk.receive(TAYLOR, "Actually, can you call me about Friday? It's urgent.");
  await expect(taylor.getByTestId("today-reason"), "out of the settle group, into New since").toHaveCount(0);
  await expect(page.getByTestId("today-settle-all")).toHaveAccessibleName("Settle all 1 in Just settle these");

  await page.getByTestId("today-settle-all").click();
  await expect(page.getByText("Settled 1 thread", { exact: true })).toBeVisible();
  expect(outbox.filter((call) => call.kind === "settle")).toEqual([{ conversationId: SOFIA, kind: "settle", messageGuid: "backlog-in-9" }]);
  await expect(rows.filter({ hasText: "Sofia Martinez" })).toHaveCount(0);
  await expect(taylor).toBeVisible();
  await expect(taylor).toHaveAttribute("aria-label", /^Taylor Morgan, unread,/);
});

test("Settle all reports a row the bridge rejected, and its Undo reopens only the rows it settled", async ({ desk }) => {
  const { page } = desk;
  const outbox = outboxLog(page);
  // Sofia's settle reaches the bridge anchored to a message that is no longer her newest, so the bridge rejects it.
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as ConvexCall | null;
    if (body?.name !== "comma/outbox:enqueue" || body.args?.payload?.kind !== "settle" || body.args.conversationId !== SOFIA) return route.continue();
    return route.continue({ postData: JSON.stringify({ ...body, args: { ...body.args, payload: { ...body.args.payload, messageGuid: "backlog-out-9" } } }) });
  });
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  const sofia = rows.filter({ hasText: "Sofia Martinez" });
  const before = await todayCount(page);

  await page.getByTestId("today-settle-all").click();
  await expect(page.getByText("Settled 1 thread · 1 couldn't be settled", { exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Taylor Morgan" })).toHaveCount(0);
  await expect(sofia.getByTestId("today-reason"), "the rejected row is back in its slot").toHaveText("No reply needed: she said thanks.");
  await expect.poll(() => todayCount(page)).toBe(before - 1);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows.filter({ hasText: "Taylor Morgan" })).toBeVisible();
  await expect.poll(() => todayCount(page)).toBe(before);
  expect(outbox.filter((call) => call.kind === "unsettle"), "no un-settle for the rejected row").toEqual([{ conversationId: TAYLOR, kind: "unsettle" }]);
  await expect(sofia.getByTestId("today-reason")).toHaveText("No reply needed: she said thanks.");
});

test("auto-advance skips a folded section", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  const below = page.getByTestId("today-fold").filter({ hasText: "Below the line" });
  await below.click();
  await expect(rows.filter({ hasText: "Noah Blake" })).toBeVisible();
  await rows.filter({ hasText: "Sofia Martinez" }).click();
  await expect(heading(page)).toHaveText("Sofia Martinez");
  // Settle right after folding, before any directory update could re-aim the advance by accident.
  await below.click();
  await page.keyboard.press("Meta+e");
  await expect(rows.filter({ hasText: "Noah Blake" })).toHaveCount(0);
  await expect(heading(page)).toHaveText("Taylor Morgan");
});

test("⌘E on Today advances once and keeps reply intent", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  const diego = rows.filter({ hasText: "Diego Santos" });
  await expect(diego).toHaveAttribute("aria-label", /^Diego Santos, unread,/);
  await rows.filter({ hasText: "Jordan Lee" }).click();
  await expect(heading(page)).toHaveText("Jordan Lee");
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+e");
  await expect(heading(page)).toHaveText("Diego Santos");
  await expect.poll(() => composerFocused(page)).toBe("iMessage");
  // A second, preview selection would leave Diego unread; the reply intent marks it read.
  await expect(diego).toHaveAttribute("aria-label", /^Diego Santos, (?!unread)/);
  await expect(heading(page)).toHaveText("Diego Santos");
});

test("fallback Today holds the open row after a reply and advances on settle", async ({ desk }) => {
  const { page, request } = desk;
  await openToday(page);
  await request.post("/__fixture/today", { data: { mode: "unbuilt" } });
  await expect(page.getByText("Today's queue builds at 7:00 AM")).toBeVisible();
  const rows = page.getByTestId("conversation-row");
  const alex = rows.filter({ hasText: "Alex Rivera" });
  await alex.click();
  await expect(heading(page)).toHaveText("Alex Rivera");
  const count = await todayCount(page);
  await page.getByPlaceholder("iMessage").fill("On it");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => todayCount(page)).toBe(count - 1);
  await page.waitForTimeout(600);
  await expect(alex).toHaveCount(1);
  await expect(heading(page)).toHaveText("Alex Rivera");
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+e");
  await expect(heading(page)).toHaveText("Launch Crew");
  await expect(alex).toHaveCount(0);
});
