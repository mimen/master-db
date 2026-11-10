import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/desk";

const out = process.env.COMPOSE_SHOTS;
test.skip(!out, "COMPOSE_SHOTS names the output directory");

const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;
const INBOUND = /^Alex Rivera: /;

async function newMessage(page: Page, phone: boolean) {
  if (phone) await page.goto("/new-chat", { waitUntil: "domcontentloaded" });
  else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("conversation-row").first()).toBeVisible();
    await page.keyboard.press("Meta+n");
  }
  const to = page.getByPlaceholder("Name, number, or email");
  await to.fill("Alex");
  await expect(page.getByText("(619) 555-0101").first()).toBeVisible();
  await to.press("Enter");
  await expect(page.getByRole("button", { name: /Remove Alex Rivera/ }).first()).toBeVisible();
  await page.getByPlaceholder("Message").last().fill("Are we still on for Friday?");
}

async function forwardChat(page: Page, phone: boolean) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByTestId("thread-view").getByRole("button", { name: INBOUND }).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Forward" }).or(page.getByRole("button", { name: "Forward", exact: true })).first().click();
  const to = page.getByPlaceholder("Forward to…").or(page.getByRole("textbox", { name: "To", exact: true })).first();
  await to.fill("Jordan");
  await expect(page.getByRole("button", { name: "Jordan Lee", exact: true }).first()).toBeVisible();
  void phone;
}

async function openInvoice(page: Page) {
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Rosa Diaz, Invoice #42 for Saturday" }).click();
  const reader = page.getByTestId("email-reader");
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  return reader;
}

async function newEmail(page: Page) {
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New email" }).click();
  const composer = page.getByTestId("email-composer");
  await composer.getByRole("textbox", { name: "To", exact: true }).fill("Jordan Kim <jordan@agency.test>;");
  await composer.getByLabel("Subject").fill("Dinner Friday?");
  await composer.getByLabel("Message").fill("Are you around Friday?");
}

async function forwardEmail(page: Page) {
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: /^Rosa Diaz, / }).click();
  await reader.getByRole("button", { name: "Forward to the message from Rosa Diaz" }).click();
  const composer = page.getByTestId("email-composer");
  await composer.getByRole("textbox", { name: "To", exact: true }).fill("carlos@books.test,");
  await composer.getByLabel("Message").fill("Carlos, for the books.");
}

async function replyAll(page: Page) {
  const reader = await openInvoice(page);
  await reader.getByRole("button", { name: "Reply all to the message from Sam Lee" }).click();
  const composer = page.getByTestId("email-composer");
  await composer.getByLabel("Message").fill("Looping in Carlos for the books.");
}

const surfaces = {
  "new-message": newMessage,
  "forward-message": forwardChat,
  "new-email": (page: Page) => newEmail(page),
  "forward-email": (page: Page) => forwardEmail(page),
  "reply-all": (page: Page) => replyAll(page),
} as const;

for (const [surface, open] of Object.entries(surfaces)) {
  for (const [device, size] of Object.entries(sizes)) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${surface} ${device} ${scheme}`, async ({ desk }) => {
        const page = desk.page;
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await desk.request.post("/__fixture/mail", { data: { invoice: true, mailboxes: true } });
        await open(page, device === "phone");
        await page.waitForTimeout(400);
        mkdirSync(out!, { recursive: true });
        await page.screenshot({ path: join(out!, `${surface}-${device}-${scheme}.png`) });
      });
    }
  }
}
