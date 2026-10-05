import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
});
const out = process.env.VERIFY_IMSG_EVIDENCE!;

async function openContacts(desk: { page: import("@playwright/test").Page }, scheme: "light" | "dark") {
  const page = desk.page;
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Contacts" }).first().click();
  await expect(page.getByLabel("Search contacts")).toBeVisible();
  await page.waitForTimeout(800);
  return page;
}

for (const scheme of ["light", "dark"] as const) {
  test(`contacts desk ${scheme}`, async ({ desk }) => {
    const page = await openContacts(desk, scheme);
    await page.screenshot({ path: `${out}/desk-contacts${scheme === "dark" ? "-dark" : ""}.png` });
  });
}

test("person edit", async ({ desk }) => {
  const page = await openContacts(desk, "light");
  await page.getByTestId("person-edit").click();
  await page.getByLabel("Nickname", { exact: true }).focus();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/desk-contact-person.png` });
});

test("merge", async ({ desk }) => {
  const page = await openContacts(desk, "light");
  await page.getByRole("button", { name: /possible duplicates?\. Review/ }).click();
  await expect(page.getByTestId("contacts-merge")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/desk-contact-merge.png` });
});

test("add from unknown", async ({ desk }) => {
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await desk.receive(desk.chats.unknown, "Hey! This is Rae from The Loft, got your number from Alex", "+16195550999");
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unknown)}`);
  await expect(page.getByTestId("unknown-sender-banner")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/desk-contact-add.png` });
});

test("contacts phone", async ({ desk }) => {
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/contacts");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/phone-contacts.png` });
  await page.getByTestId("contact-row").first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/phone-contact-person.png` });
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/phone-contact-person-scrolled.png` });
});
