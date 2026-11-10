import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

const row = (page: Page, name: string) => page.getByTestId("conversation-row").filter({ hasText: name }).first();

async function open(page: Page, lens: RegExp): Promise<void> {
  // The fixture's messages are from FIXTURE_NOW; at the real clock every turn would read as late.
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: lens }).first().click();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
}

test("the source sits on the avatar and the agent reads as one chip on the preview line", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seedChannel: true } });
  await desk.request.post("/__fixture/mail", { data: { mailboxes: true } });
  await open(page, /^Today/);

  for (const [name, source] of [["Alex Rivera", "iMessage"], ["#bookings", "Slack"], ["Sam Lee", "Gmail"]] as const) {
    const target = row(page, name);
    await expect(target.getByTestId("avatar-source"), `${name} carries its source on the avatar`).toHaveCount(1);
    await expect(target, "the source is still spoken").toHaveAttribute("aria-label", new RegExp(source));
  }
  // The name line holds the name and the star, with no glyph after them.
  const nameLine = row(page, "Alex Rivera").getByText("Alex Rivera", { exact: true });
  await expect(nameLine.locator("xpath=..").locator("svg")).toHaveCount(0);
  await expect(row(page, "Alex Rivera").getByLabel("Favorite")).toHaveCSS("color", "rgb(100, 100, 107)");

  await page.getByRole("tab", { name: /^All/ }).first().click();
  await expect(row(page, "Diego Santos").getByTestId("row-chip")).toContainText("Agent: asking you");
  await expect(row(page, "Riley Chen").getByTestId("row-chip")).toContainText("Agent: ready");
  await expect(row(page, "Avery Brooks").getByTestId("row-chip")).toHaveCount(0);
  await expect(page.getByTestId("agent-badge")).toHaveCount(0);
});

test("a lens that already means attention shows unread as a semibold name, never a dot", async ({ desk }) => {
  const page = desk.page;
  await open(page, /^To review/);
  await expect(page.getByTestId("unread-dot")).toHaveCount(0);
  const unread = row(page, "Avery Brooks").getByText("Avery Brooks", { exact: true });
  await expect(unread).toHaveCSS("font-weight", "600");
  await page.getByRole("tab", { name: /^All/ }).first().click();
  await expect(row(page, "Avery Brooks").getByTestId("unread-dot"), "other lenses keep the dot").toHaveCount(1);
  await expect(row(page, "Jordan Lee").getByText("Jordan Lee", { exact: true }), "names stay semibold outside unread lenses").toHaveCSS("font-weight", "600");
});

test("the row ring follows the keyboard, and a click clears it", async ({ desk }) => {
  const page = desk.page;
  await open(page, /^All/);
  const alex = row(page, "Alex Rivera");
  await alex.click();
  await expect(alex).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Escape");
  await expect(alex, "Escape enters glide: the keyboard ring").toHaveCSS("outline-style", "solid");
  await expect(alex).toHaveCSS("outline-color", "rgb(59, 130, 246)");
  await page.getByTestId("thread-view").click({ position: { x: 300, y: 120 } });
  await expect(alex, "a pointer press hides it").toHaveCSS("outline-style", "none");
});

test("the composer zone is one line: turn and Settle, details in the tooltip, no retry where suggestions never run", async ({ desk }) => {
  const page = desk.page;
  const channel = (await (await desk.request.post("/__fixture/slack", { data: { seedChannel: true } })).json()).conversationId as string;
  await open(page, /^Today/);
  await row(page, "Alex Rivera").click();
  const strip = page.getByTestId("state-strip");
  await expect(strip).toContainText(/Your turn · \d+[mhdw]/);
  await expect(strip).not.toContainText("today");
  await expect(page.getByTestId("strip-lead")).toHaveAttribute("title", /#1 today · /);
  await expect(strip.getByTestId("thread-settle")).toBeVisible();
  await expect(strip.getByTestId("suggestion-alternates")).toBeVisible();
  const box = (await strip.boundingBox())!;
  expect(box.height, "one line").toBeLessThanOrEqual(36);

  await page.goto(`/c/${channel}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder("Message #bookings")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "Retry suggestions" })).toHaveCount(0);
  await expect(page.getByTestId("suggestion-alternates")).toHaveCount(0);
});

test("Later's state shares the strip's line", async ({ desk }) => {
  const page = desk.page;
  await open(page, /^All/);
  await row(page, "Jordan Lee").click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await row(page, "Jordan Lee").click({ button: "right" });
  await page.getByRole("dialog").getByText("Follow up…", { exact: true }).click();
  await page.getByRole("dialog").getByText("In 2 days", { exact: true }).click();
  await expect(page.getByTestId("state-strip").getByTestId("strip-later")).toHaveText(/Follow up .* if no reply$/);
});
