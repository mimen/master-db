import { writeFileSync } from "node:fs";
import { expect, test } from "../fixtures/desk";
const out = process.env.VERIFY_IMSG_EVIDENCE!;

async function openContact(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Contacts" }).first().click();
  await page.getByTestId("contact-row").filter({ hasText: name }).first().click();
}

test("guest-list: one tap from the DM info pane, re-read on the contact card", async ({ desk }) => {
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`);
  await page.getByRole("button", { name: "Conversation info" }).click();

  const list = page.getByTestId("guest-list");
  await expect(list).toContainText("Freakuency 2027");
  await expect(list).not.toContainText("left");
  await expect(list).toContainText("Kiki Factory 2027");
  await expect(list).toContainText("Closed");
  await expect(list.getByRole("button", { name: "Add to Kiki Factory 2027 guest list" })).toHaveCount(0);
  await page.screenshot({ path: `${out}/dm-before.png` });

  await list.getByRole("button", { name: "Add to Freakuency 2027 guest list" }).click();
  await expect(page.getByText("Added to Freakuency 2027")).toBeVisible();
  await expect(list).toContainText("On list");
  await expect(list.getByRole("button", { name: "Add to Freakuency 2027 guest list" })).toHaveCount(0);
  await expect(list.getByLabel("Email")).toHaveCount(0);
  await page.screenshot({ path: `${out}/dm-after.png` });
  writeFileSync(`${out}/aria-dm.txt`, await list.ariaSnapshot());

  await openContact(page, "Alex Rivera");
  const card = page.getByTestId("guest-list");
  await expect(card).toContainText("On list");
  await expect(card.getByRole("button", { name: "Add to Freakuency 2027 guest list" })).toHaveCount(0);
  await page.screenshot({ path: `${out}/card-reread.png` });
});

test("guest-list: a contact without an email gets the form, prefilled with their name", async ({ desk }) => {
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openContact(page, "Jordan Lee");

  const list = page.getByTestId("guest-list");
  await list.getByRole("button", { name: "Add to Freakuency 2027 guest list" }).click();
  await expect(list.getByLabel("First name")).toHaveValue("Jordan");
  await expect(list.getByLabel("Last name")).toHaveValue("Lee");
  await expect(list.getByLabel("Email")).toHaveValue("");
  const submit = list.getByRole("button", { name: "Add Jordan to Freakuency 2027" });
  await expect(submit).toBeDisabled();
  await page.screenshot({ path: `${out}/form-empty.png` });

  await list.getByLabel("Email").fill("jordan@example.test");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Added to Freakuency 2027")).toBeVisible();
  await expect(list).toContainText("On list");
  await expect(list.getByLabel("Email")).toHaveCount(0);
  await page.screenshot({ path: `${out}/form-after.png` });
  writeFileSync(`${out}/aria-form.txt`, await list.ariaSnapshot());
});
