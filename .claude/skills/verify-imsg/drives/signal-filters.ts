import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test as deskTest } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;

async function needsReply(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.getByRole("tab", { name: /^Needs reply/ }).click();
  await page.waitForTimeout(400);
}

async function renderedNames(page: Page): Promise<string[]> {
  return page.getByTestId("conversation-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")?.split(",")[0] ?? ""));
}

deskTest("signal-filters: desktop light", async ({ desk }) => {
  const page = desk.page;
  await needsReply(page, "light");
  for (const name of ["Needs reply", "Unread", "Waiting", "All"]) {
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveCount(1);
  }
  await expect(page.getByRole("heading", { name: "Today" }).or(page.getByRole("heading", { name: "This week" })).or(page.getByRole("heading", { name: "Older" })).first()).toBeVisible();

  // The thread's "N of M" counts the rendered order.
  // The list virtualizes, so the total comes from the lens count; the index from the clicked row.
  const total = Number((await page.getByRole("tab", { name: /^Needs reply/ }).getAttribute("aria-label"))?.split(", ")[1]);
  const names = await renderedNames(page);
  await page.getByTestId("conversation-row").nth(1).click();
  await expect(page.getByTestId("thread-view")).toBeVisible();
  await expect(page.getByLabel(`Conversation 2 of ${total}`)).toBeVisible();
  await expect(page.getByTestId("thread-view").getByText(names[1]!, { exact: true }).first()).toBeVisible();

  // ⌘2 switches to Unread, ⌘1 back.
  await page.mouse.move(700, 300);
  await page.keyboard.press("Meta+2");
  await expect(page.getByRole("tab", { name: /^Unread/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Meta+1");
  await expect(page.getByRole("tab", { name: /^Needs reply/ })).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(evidence, "desk-main-light.png") });

  // Filter popover with live counts; a service dropdown open.
  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filter conversations" });
  await expect(dialog.getByText(/^Showing \d+ of \d+ in Needs reply$/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: /^Pinned/ }).click();
  await dialog.getByRole("checkbox", { name: /^Pinned/ }).click();
  await dialog.getByRole("button", { name: /^Service,/ }).click();
  await page.getByRole("option", { name: "iMessage" }).click();
  await expect(dialog.getByRole("button", { name: "Service, iMessage" })).toBeVisible();
  const showing = Number((await dialog.getByText(/^Showing \d+ of/).textContent())?.match(/Showing (\d+)/)?.[1]);
  await dialog.getByRole("button", { name: /^Service,/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, "desk-filters-light.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.click(1200, 880);

  // Chips row and the filter badge; the count still matches the filtered order.
  await expect(page.getByRole("button", { name: "Remove filter iMessage" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter conversations, 1 active" })).toBeVisible();
  expect(showing).toBeGreaterThan(0);
  await page.getByTestId("conversation-row").first().click();
  await expect(page.getByLabel(`Conversation 1 of ${showing}`)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, "desk-chips-light.png") });
  await page.getByRole("button", { name: "Remove filter iMessage" }).click();
  await expect(page.getByRole("button", { name: "Remove filter iMessage" })).toHaveCount(0);
});

deskTest("signal-filters: desktop dark", async ({ desk }) => {
  const page = desk.page;
  await needsReply(page, "dark");
  await page.getByTestId("conversation-row").first().click();
  await page.mouse.move(700, 300);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(evidence, "desk-main-dark.png") });
  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  await page.getByRole("dialog", { name: "Filter conversations" }).getByRole("button", { name: /^People,/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, "desk-filters-dark.png") });
});

deskTest("signal-filters: phone chips and sheet", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.getByRole("tab", { name: /^Needs reply/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, "phone-list.png") });
  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filter conversations" });
  await expect(sheet.getByText("Filter", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Show \d+ conversations?$/ })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "phone-filters.png") });
  await sheet.getByRole("switch", { name: /^Pinned/ }).or(sheet.getByRole("checkbox", { name: /^Pinned/ })).first().click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Remove filter Pinned" })).toBeVisible();
  await expect(page.getByText(/^\d+ of \d+ match$/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(evidence, "phone-chips.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: /^Filter conversations/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "phone-filters-dark.png") });
});
