import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (page: Page, name: string) => page.screenshot({ path: join(evidence, `${name}.png`), animations: "disabled" });

async function settle(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(700);
}

async function openThread(page: Page, name: string | RegExp): Promise<void> {
  await page.getByTestId("conversation-row").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("thread-view")).toBeVisible();
  await settle(page);
}

for (const scheme of ["light", "dark"] as const) {
  test(`platform-seams: desktop ${scheme}`, async ({ desk }) => {
    const page = desk.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

    await page.goto("/ui-gallery", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ui-gallery")).toBeVisible();
    await settle(page);
    await shot(page, `gallery-${scheme}`);

    await page.goto("/");
    await page.getByRole("tab", { name: /^All/ }).click();
    await openThread(page, "Alex Rivera");
    await expect(page.getByPlaceholder("iMessage")).toBeVisible();
    await expect(page.getByTestId("composer-service")).toHaveAccessibleName("Service: iMessage");
    await shot(page, `imessage-thread-${scheme}`);
    await page.getByTestId("composer-service").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settle(page);
    await shot(page, `imessage-send-with-${scheme}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "FaceTime actions" }).first().click();
    await expect(page.getByText("FaceTime Video", { exact: true })).toBeVisible();
    await settle(page);
    await shot(page, `facetime-${scheme}`);
    await page.keyboard.press("Escape");

    await openThread(page, "Old SMS receipt");
    await expect(page.getByPlaceholder("Text Message")).toBeVisible();
    await expect(page.getByTestId("composer-service")).toHaveAccessibleName("Service: SMS");
    await shot(page, `sms-thread-${scheme}`);
    await page.getByTestId("composer-service").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settle(page);
    await shot(page, `sms-send-with-${scheme}`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Filter conversations/ }).click();
    const dialog = page.getByRole("dialog", { name: "Filter conversations" });
    await dialog.getByRole("button", { name: /^Service,/ }).click();
    await expect(page.getByRole("option", { name: "SMS" })).toBeVisible();
    await settle(page);
    await shot(page, `filter-service-${scheme}`);
    await page.getByRole("option", { name: "SMS" }).click();
    await expect(dialog.getByRole("button", { name: "Service, SMS" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Remove filter SMS" })).toBeVisible();
    await settle(page);
    await shot(page, `filter-chip-${scheme}`);
    await page.getByRole("button", { name: "Remove filter SMS" }).click();

    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("textbox").first();
    await palette.fill("go to");
    await settle(page);
    await shot(page, `palette-goto-${scheme}`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await settle(page);
    await shot(page, `contacts-${scheme}`);
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await expect(page.getByRole("button", { name: "Contacts", exact: true })).toBeVisible();
  });
}

test("platform-seams: phone tab bar", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const bar = page.getByTestId("phone-tab-bar");
  await expect(bar).toBeVisible();
  await settle(page);
  await shot(page, "phone-messages");
  await bar.getByRole("tab", { name: "Contacts" }).click();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await settle(page);
  await shot(page, "phone-contacts");
  await bar.getByRole("tab", { name: /^Messages/ }).click();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
});
