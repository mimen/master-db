import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (page: Page, name: string) => page.screenshot({ path: join(evidence, `${name}.png`) });

async function open(page: Page, scheme: "light" | "dark"): Promise<void> {
  // The page reads the fixture's day, so ages and "Built 10:30 AM" line up with the seeded world.
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("/");
  await expect(page.getByTestId("today-header")).toBeVisible();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.mouse.move(900, 300);
  await page.waitForTimeout(400);
}

async function todayCount(page: Page): Promise<number> {
  const label = await page.getByRole("tab", { name: /^Today, \d+/ }).getAttribute("aria-label");
  return Number(/(\d+)/.exec(label ?? "")?.[1]);
}

const row = (page: Page, name: string) => page.getByTestId("conversation-row").filter({ hasText: name });

test("today-queue: opens on Today, strip rank, settle gap, Regenerate, unbuilt and failed headers", async ({ desk }) => {
  const { page, request } = desk;
  const enqueued: string[] = [];
  const builds: string[] = [];
  page.on("request", (req) => {
    if (!req.url().includes("/__fixture/convex")) return;
    const body = req.postDataJSON() as { name?: string; args?: { payload?: { kind?: string } } } | null;
    if (body?.name === "comma/outbox:enqueue" && body.args?.payload?.kind) enqueued.push(body.args.payload.kind);
    if (body?.name === "comma/today:requestBuild") builds.push(body.name);
  });

  // Lands on Today: header, groups with context, ranks and reasons.
  await open(page, "light");
  await expect(page.getByRole("tab", { name: /^Today, \d+/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("today-meta")).toHaveText(/^Built \d+:\d\d [AP]M · Opus 5\.5 · 12 of 15 threads$/);
  await expect(page.getByText("Friday at the Observatory", { exact: true })).toBeVisible();
  await expect(page.getByText(/^New since \d+:\d\d [AP]M$/)).toBeVisible();
  await expect(row(page, "Alex Rivera").getByTestId("today-rank")).toHaveText("1");
  await expect(row(page, "Alex Rivera").getByTestId("today-reason")).toHaveText("The final arrival time unblocks the run of show.");
  await shot(page, "01-today-light");
  writeFileSync(join(evidence, "aria-list.txt"), await page.getByTestId("conversation-list-scroll").ariaSnapshot());
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  await shot(page, "02-today-dark");
  await page.emulateMedia({ colorScheme: "light" });

  // The folds close the list: Below the line opens to the two Needs you threads the build left out.
  const below = page.getByTestId("today-fold").filter({ hasText: "Below the line" });
  await below.scrollIntoViewIfNeeded();
  await expect(below).toHaveAttribute("aria-expanded", "false");
  await below.click();
  await expect(row(page, "Noah Blake")).toBeVisible();
  await page.mouse.move(900, 300);
  await page.waitForTimeout(300);
  await shot(page, "02b-below-the-line");
  await below.click();
  await page.getByTestId("conversation-list-scroll").evaluate((element) => element.scrollTo(0, 0));

  // A ranked conversation's strip names its place.
  await row(page, "Priya Shah").click();
  const strip = page.getByTestId("state-strip");
  await expect(strip.getByTestId("strip-today")).toHaveText("#2 todayGuest list locks at 6 PM.");
  await page.mouse.move(900, 300);
  await page.waitForTimeout(300);
  await shot(page, "03-strip-rank");

  // Settle Priya from the strip: rank 2 leaves a gap and progress moves by one.
  const progressBefore = await page.getByTestId("today-progress").textContent();
  const countBefore = await todayCount(page);
  await page.getByTestId("thread-settle").click();
  await expect.poll(() => todayCount(page)).toBe(countBefore - 1);
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await expect(row(page, "Priya Shah")).toHaveCount(0);
  const friday = await page.getByTestId("today-rank").allTextContents();
  expect(friday.slice(0, 3)).toEqual(["", "1", "3"]);
  const progressAfter = await page.getByTestId("today-progress").textContent();
  expect(progressAfter).not.toBe(progressBefore);
  expect(enqueued).toContain("settle");
  await page.mouse.move(900, 300);
  await page.waitForTimeout(400);
  await shot(page, "04-settled-gap");
  writeFileSync(join(evidence, "progress.txt"), `before: ${progressBefore}\nafter: ${progressAfter}\ntab: ${countBefore} -> ${countBefore - 1}\n`);

  // Regenerate: busy first, then New since folds into the ranked groups.
  await page.getByTestId("today-regenerate").click();
  await expect(page.getByTestId("today-regenerate")).toHaveText("Regenerating");
  await shot(page, "05-regenerating");
  await expect(page.getByTestId("today-regenerate")).toHaveText("Regenerate", { timeout: 10_000 });
  await expect(page.getByText(/^New since /)).toHaveCount(0);
  await expect(page.getByText("Start here", { exact: true })).toBeVisible();
  await expect(row(page, "Launch Crew").getByTestId("today-rank")).not.toHaveText("");
  expect(builds).toEqual(["comma/today:requestBuild"]);
  await page.mouse.move(900, 300);
  await page.waitForTimeout(400);
  await shot(page, "06-regenerated");
  writeFileSync(join(evidence, "aria-regenerated.txt"), await page.getByTestId("today-header").ariaSnapshot());

  // Before the morning build, and a failed build: the header says so and the list falls back to Needs you.
  await request.post("/__fixture/today", { data: { mode: "unbuilt" } });
  await expect(page.getByText("Today's queue builds at 7:00 AM")).toBeVisible();
  await expect(page.getByText("Needs you", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Start here", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(600);
  await shot(page, "07-unbuilt");
  await request.post("/__fixture/today", { data: { mode: "failed" } });
  await expect(page.getByText("Couldn't build today's queue")).toBeVisible();
  await expect(page.getByText(/^The gateway timed out at 7:00 AM$/)).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, "08-failed");
});
