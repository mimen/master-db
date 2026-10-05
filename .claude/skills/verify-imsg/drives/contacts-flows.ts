import { writeFileSync } from "node:fs";
import { expect, test } from "../fixtures/desk";
const out = process.env.VERIFY_IMSG_EVIDENCE!;

async function openContacts(page: import("@playwright/test").Page) {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Contacts" }).first().click();
  await expect(page.getByLabel("Search contacts")).toBeVisible();
}

test("contacts-flows: search, edit name, primary, favorite, merge", async ({ desk }) => {
  const page = desk.page;
  await openContacts(page);

  await page.getByLabel("Search contacts").fill("555-0102");
  await expect(page.getByTestId("contact-row")).toHaveCount(1);
  await expect(page.getByTestId("contact-row")).toContainText("Jordan Lee");
  await page.getByLabel("Search contacts").fill("okafor");
  await expect(page.getByTestId("contact-row")).toContainText("Maya Patel");
  await page.getByLabel("Search contacts").fill("");

  await page.getByTestId("contact-row").filter({ hasText: "Alex Rivera" }).first().click();
  await page.getByTestId("person-edit").click();
  await page.getByLabel("Nickname", { exact: true }).fill("Lex");
  await page.getByTestId("person-done").click();
  await expect(page.getByLabel("Nickname", { exact: true })).toHaveValue("Lex");

  await page.getByRole("button", { name: "Make alex@nightshift.example primary" }).click();
  await expect(page.getByTestId("handle-row").filter({ hasText: "alex@nightshift.example" })).toContainText("Primary");

  const favorite = page.getByRole("switch", { name: "Favorite" });
  await expect(favorite).toBeChecked();
  await favorite.click();
  await expect(favorite).not.toBeChecked();
  await expect(page.getByText("Favorites", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: /1 possible duplicate\. Review/ })).toBeVisible();
  await page.getByRole("button", { name: /possible duplicates?\. Review/ }).click();
  await page.getByRole("radio", { name: /Keep Maya Patel, no organization/ }).click();
  await expect(page.getByRole("heading", { name: "Merge Maya Patel" })).toBeVisible();
  await page.screenshot({ path: `${out}/merge-before.png` });
  await page.getByTestId("merge-contacts").click();
  await expect(page.getByTestId("contacts-merge")).toHaveCount(0);
  await expect(page.getByTestId("contact-row").filter({ hasText: "Maya Patel" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /possible duplicate/ })).toHaveCount(0);
  await expect(page.getByTestId("handle-row")).toHaveCount(3);
  await page.screenshot({ path: `${out}/merge-after.png` });
  writeFileSync(`${out}/aria-person.txt`, await page.getByRole("main").ariaSnapshot());
});

test("contacts-flows: add an unknown number from its thread", async ({ desk }) => {
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await desk.receive(desk.chats.unknown, "Hey! This is Rae from The Loft", "+16195550999");
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unknown)}`);
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByLabel("First name")).toHaveValue("Rae");
  await expect(page.getByLabel("Organization")).toHaveValue("The Loft");
  await page.getByLabel("Last name").fill("Ito");
  await page.getByTestId("save-contact").click();
  await expect(page.getByTestId("unknown-sender-banner")).toHaveCount(0);

  await page.getByRole("button", { name: "Contacts" }).first().click();
  await page.getByLabel("Search contacts").fill("Loft");
  await expect(page.getByTestId("contact-row")).toContainText("Rae Ito");
  await page.screenshot({ path: `${out}/added.png` });
});
