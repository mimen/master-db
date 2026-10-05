import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
type Scheme = "light" | "dark";

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, `${name}.png`) });
}

async function open(page: Page, scheme: Scheme, width = 1440, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
}

async function openThread(page: Page, name: string): Promise<void> {
  await page.getByTestId("conversation-row").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("thread-view")).toBeVisible();
  await page.mouse.move(1000, 120);
}

test.setTimeout(120_000);

for (const scheme of ["light", "dark"] as const) {
  test(`parity desk main ${scheme}`, async ({ desk }) => {
    await desk.receive(desk.chats.needs, "Would you mind bumping him for me?");
    await desk.receive(desk.chats.needs, "No rush if he's slammed, I just need set times by tonight");
    await open(desk.page, scheme);
    await openThread(desk.page, "Alex Rivera");
    await shot(desk.page, `desk-main${scheme === "dark" ? "-dark" : ""}`);
    await desk.page.keyboard.press("Meta+k");
    await shot(desk.page, `desk-palette${scheme === "dark" ? "-dark" : ""}`);
    await desk.page.keyboard.type("sho");
    await shot(desk.page, `desk-palette-typed${scheme === "dark" ? "-dark" : ""}`);
  });
}

test("parity desk details, group, hover, menu", async ({ desk }) => {
  const page = desk.page;
  await open(page, "light");
  await openThread(page, "Alex Rivera");
  await page.keyboard.press("Meta+i");
  await shot(page, "desk-details");
  await page.keyboard.press("Meta+i");
  await openThread(page, "Launch Crew");
  await shot(page, "desk-group");
  await page.getByTestId("message-bubble").last().click({ button: "right" });
  await shot(page, "desk-message-menu");
  await page.keyboard.press("Escape");
  await page.getByTestId("conversation-row").nth(2).hover();
  await shot(page, "desk-hover");
});

test("parity desk scheduled, settings, contacts, filters, states", async ({ desk }) => {
  const page = desk.page;
  await open(page, "light");
  await openThread(page, "Alex Rivera");
  await page.getByRole("button", { name: "Scheduled" }).click();
  await shot(page, "desk-scheduled");
  await page.getByLabel("Close scheduled").click();
  await page.getByRole("button", { name: "Settings" }).click();
  await shot(page, "desk-settings");
  await page.getByLabel("Close settings").click();
  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  await shot(page, "desk-filters");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await expect(page.getByLabel("Search contacts")).toBeVisible();
  await shot(page, "desk-contacts");
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await desk.setTyping(desk.chats.needs, true);
  await shot(page, "desk-states-typing");
});

test("parity desk empty", async ({ desk }) => {
  const page = desk.page;
  await open(page, "light");
  await page.getByRole("tab", { name: /^Unread/ }).click();
  await page.getByTestId("conversation-row").first().click();
  for (let i = 0; i < 20; i++) {
    if ((await page.getByTestId("conversation-row").count()) === 0) break;
    await page.keyboard.press("Meta+e");
    await page.waitForTimeout(350);
  }
  await page.keyboard.press("Escape");
  await shot(page, "desk-empty-unread");
  await page.getByRole("tab", { name: /^Needs reply/ }).click();
  await shot(page, "desk-empty-needs");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await shot(page, "desk-empty-dark");
});

for (const scheme of ["light", "dark"] as const) {
  test(`parity phone ${scheme}`, async ({ desk }) => {
    const page = desk.page;
    await desk.receive(desk.chats.needs, "Would you mind bumping him for me?");
    await open(page, scheme, 390, 844);
    const suffix = scheme === "dark" ? "-dark" : "";
    await shot(page, `phone-list${suffix}`);
    await openThread(page, "Alex Rivera");
    await shot(page, `phone-thread${suffix}`);
    if (scheme === "dark") return;
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await shot(page, "phone-details");
    await page.goto("/");
    await expect(page.getByTestId("conversation-row").first()).toBeVisible();
    await page.getByLabel("Search conversations and messages").fill("sho");
    await shot(page, "phone-search");
  });
}
