import type { Page } from "@playwright/test";
import { expect, test, viewCount } from "../fixtures/desk";
import { fixtureConversationId } from "../../shared/fixture-ids";
import { FIXTURE_NOW } from "./world";

const todayCount = (page: Page) => viewCount(page, "Today");

async function openToday(page: Page): Promise<void> {
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

const newSince = (page: Page) => page.getByTestId("today-fold").filter({ hasText: "New since" });
const heading = (page: Page) => page.getByTestId("thread-view").getByRole("heading", { level: 2 });
const composerFocused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("placeholder"));

test("the app opens on Today; a settle leaves a rank gap and moves progress; Update ranks New since into the groups", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  await expect(page.getByRole("button", { name: "View, Today" })).toBeVisible();
  await expect(page.getByTestId("today-meta")).toHaveText("Updated 10:30 AM");
  await expect(page.getByTestId("today-meta")).toHaveAttribute("title", "Session from Aug 19 · Opus 5.5 · read 15 of 21 threads");
  await expect(page.getByText("New since 10:30 AM", { exact: true })).toBeVisible();
  const rows = page.getByTestId("conversation-row");
  const alex = rows.filter({ hasText: "Alex Rivera" });
  await expect(alex.getByTestId("today-reason")).toHaveText("The final arrival time unblocks the run of show.");
  // Arrivals stay out of the bar's finish line.
  await expect(page.getByTestId("today-progress")).toHaveText("0 settled · 12 to go · 2 new");

  // One chunk at a time: the settle sweep leads, the first group is open, arrivals and later groups wait folded.
  await expect(rows, "two to settle and the four in Friday's group").toHaveCount(6);
  await expect(rows.filter({ hasText: "Nina Park" }), "Money waits folded").toHaveCount(0);
  await expect(newSince(page).getByTestId("today-fold-preview"), "the fold names who wrote").toContainText("Launch Crew");
  await expect(page.getByTestId("today-fold").filter({ hasText: "Money" })).toHaveAttribute("aria-expanded", "false");
  await expect(rows.filter({ hasText: "Launch Crew" }), "an arrival does not jump the queue").toHaveCount(0);
  await newSince(page).click();
  await expect(rows.filter({ hasText: "Launch Crew" })).toBeVisible();
  await newSince(page).click();

  await rows.filter({ hasText: "Priya Shah" }).click();
  // The rank and reason live in the lead's tooltip, not on the line.
  await expect(page.getByTestId("strip-lead")).toHaveAttribute("title", /#2 today · Guest list locks at 6 PM\./);
  await page.getByTestId("thread-settle").click();
  await expect.poll(() => todayCount(page)).toBe(13);
  await expect(page.getByTestId("today-progress")).toHaveText("1 settled · 11 to go · 2 new");
  await alex.click();
  await expect(rows.filter({ hasText: "Priya Shah" })).toHaveCount(0);
  expect((await page.getByTestId("today-rank").allTextContents()).filter(Boolean).slice(0, 2)).toEqual(["1", "3"]);

  await page.getByTestId("today-update").click();
  await expect(page.getByTestId("today-update")).toHaveText("Updating");
  await expect(page.getByTestId("today-meta")).toHaveText("Checking what changed with Opus 5.5…");
  await expect(page.getByTestId("today-build-menu")).toBeDisabled();
  await expect(page.getByTestId("today-update")).toHaveText("Update", { timeout: 10_000 });
  await expect(page.getByTestId("today-meta")).toHaveText(/^Updated \d+:\d\d [AP]M$/);
  await expect(page.getByTestId("today-meta")).toHaveAttribute("title", /^Session from Aug 19 · Opus 5\.5 · read \d+ of \d+ threads$/);
  await expect(page.getByText("New since 10:30 AM", { exact: true })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Launch Crew" }).getByTestId("today-rank")).toHaveText("1");
  await expect(page.getByTestId("today-progress")).toHaveText("1 settled · 14 to go");
});

test("Today ranks a People email beside Messages; it opens in the Mail reader, and the newsletter and the stranger stay out", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  await expect(rows.filter({ hasText: "Club Weekly" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Pat Moreno" })).toHaveCount(0);
  const mail = rows.filter({ hasText: "Load-in is at 6 pm" });
  await expect(mail, "arrived after the build: folded in New since").toHaveCount(0);
  await newSince(page).click();
  await expect(mail.getByTestId("today-rank")).toHaveText("");
  await page.getByTestId("today-update").click();
  await expect(page.getByTestId("today-update")).toHaveText("Update", { timeout: 10_000 });
  await expect(mail.getByTestId("today-rank"), "the build ranks it").toHaveText(/^\d+$/);

  await mail.click();
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();
});

test("the Service filter narrows Today, Gmail included, while the tab keeps counting the whole plan", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  await newSince(page).click();
  await expect(rows.filter({ hasText: "Load-in is at 6 pm" })).toBeVisible();
  const total = await todayCount(page);
  const service = async (name: string) => {
    await page.getByRole("button", { name: /^Service, / }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };

  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  await service("Gmail");
  await page.getByRole("button", { name: "Close filters" }).click({ position: { x: 1200, y: 800 } });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Load-in is at 6 pm");
  await expect(rows.first()).toHaveAttribute("aria-label", /, Gmail$/);
  expect(await todayCount(page), "the tab counts the plan, not the filter").toBe(total);
  await expect(page.getByRole("button", { name: "Remove filter Gmail" })).toBeVisible();

  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  await service("iMessage");
  await page.getByRole("button", { name: "Close filters" }).click({ position: { x: 1200, y: 800 } });
  await expect(rows.filter({ hasText: "Load-in is at 6 pm" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "Alex Rivera" })).toBeVisible();

  await page.getByRole("button", { name: "Remove filter iMessage" }).click();
  await expect(rows.filter({ hasText: "Load-in is at 6 pm" })).toBeVisible();
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
  await expect(page.getByTestId("today-meta")).toHaveText(/^Built \d+:\d\d [AP]M$/);
  await expect(page.getByTestId("today-meta")).toHaveAttribute("title", /^Opus 5\.5 · read \d+ of \d+ threads$/);
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
  await expect(page.getByTestId("today-progress")).toHaveText(`2 settled · ${before - 4} to go · 2 new`);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => todayCount(page)).toBe(before);
  await expect(page.getByText("Just settle these", { exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Taylor Morgan" })).toBeVisible();
  await expect(rows.filter({ hasText: "Sofia Martinez" })).toBeVisible();
  await expect(page.getByTestId("today-progress")).toHaveText(`0 settled · ${before - 2} to go · 2 new`);
});

const TAYLOR = "iMessage;-;+16195550204";
const SOFIA = "iMessage;-;+16195550209";
type ConvexCall = { name?: string; args?: { conversationId?: string; anchor?: string } };

/** Every settle and un-settle the client sends Convex, as kind, conversation and anchor. */
function triageLog(page: Page): { conversationId?: string; kind?: string; messageGuid?: string }[] {
  const log: { conversationId?: string; kind?: string; messageGuid?: string }[] = [];
  page.on("request", (req) => {
    if (!req.url().endsWith("/__fixture/convex")) return;
    const body = req.postDataJSON() as ConvexCall | null;
    const kind = /^comma\/triage:(settle|unsettle)$/.exec(body?.name ?? "")?.[1];
    if (kind) log.push({ conversationId: body?.args?.conversationId, kind, ...(body?.args?.anchor ? { messageGuid: body.args.anchor } : {}) });
  });
  return log;
}

test("a settle-group thread that gets a new message after the build moves to New since, and Settle all leaves it alone", async ({ desk }) => {
  const { page } = desk;
  const triage = triageLog(page);
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  const taylor = rows.filter({ hasText: "Taylor Morgan" });
  await expect(taylor.getByTestId("today-reason")).toHaveText("No reply needed: a tapback closed it.");

  await desk.receive(TAYLOR, "Actually, can you call me about Friday? It's urgent.");
  await expect(taylor.getByTestId("today-reason"), "out of the settle group, into New since").toHaveCount(0);
  await expect(page.getByTestId("today-settle-all")).toHaveAccessibleName("Settle all 1 in Just settle these");

  await page.getByTestId("today-settle-all").click();
  await expect(page.getByText("Settled 1 thread", { exact: true })).toBeVisible();
  expect(triage.filter((call) => call.kind === "settle")).toEqual([{ conversationId: fixtureConversationId(SOFIA), kind: "settle", messageGuid: "backlog-in-9" }]);
  await expect(rows.filter({ hasText: "Sofia Martinez" })).toHaveCount(0);
  await newSince(page).click();
  await expect(taylor).toBeVisible();
  await expect(taylor).toHaveAttribute("aria-label", /^Taylor Morgan, unread,/);
});

test("Settle all reports a row Convex rejected, and its Undo reopens only the rows it settled", async ({ desk }) => {
  const { page } = desk;
  const triage = triageLog(page);
  // Sofia's settle reaches Convex anchored to a message that is no longer her newest, so Convex rejects it.
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as ConvexCall | null;
    if (body?.name !== "comma/triage:settle" || body.args?.conversationId !== fixtureConversationId(SOFIA)) return route.continue();
    return route.continue({ postData: JSON.stringify({ ...body, args: { ...body.args, anchor: "backlog-out-9" } }) });
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
  expect(triage.filter((call) => call.kind === "unsettle"), "no un-settle for the rejected row").toEqual([{ conversationId: fixtureConversationId(TAYLOR), kind: "unsettle" }]);
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
  // The settle sweep's last row leads into the open group, not back up the list.
  await expect(heading(page)).toHaveText("Alex Rivera");
});

test("finishing a group advances into the next one, which opens; Skip today pushes a row to tomorrow", async ({ desk }) => {
  const { page } = desk;
  await openToday(page);
  const rows = page.getByTestId("conversation-row");
  await rows.filter({ hasText: "Alex Rivera" }).click();
  for (const name of ["Alex Rivera", "Priya Shah", "Jordan Lee", "Diego Santos"]) {
    await expect(heading(page)).toHaveText(name);
    await expect(rows.filter({ hasText: "Nina Park" }), "Money stays folded while Friday has rows").toHaveCount(0);
    await page.keyboard.press("Meta+e");
  }
  await expect(heading(page), "the group's last row leads into Money, which opens").toHaveText("Nina Park");
  await expect(rows.filter({ hasText: "Nina Park" })).toBeVisible();

  const before = await todayCount(page);
  await rows.filter({ hasText: "Marcus Reed" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Skip today/ }).click();
  await expect(page.getByText(/^Snoozed until /)).toBeVisible();
  await expect(rows.filter({ hasText: "Marcus Reed" })).toHaveCount(0);
  await expect.poll(() => todayCount(page)).toBe(before - 1);
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
