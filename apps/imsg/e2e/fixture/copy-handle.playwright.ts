import { expect, test } from "../fixtures/desk";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const clipboard = (page: import("@playwright/test").Page) => page.evaluate(() => navigator.clipboard.readText());

test("right-clicking a conversation copies the person's phone number", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/");
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click({ button: "right" });
  await page.getByRole("dialog").getByText("Copy phone number", { exact: true }).click();
  await expect(page.getByText("Copied (619) 555-0101")).toBeVisible();
  expect(await clipboard(page)).toBe("(619) 555-0101");
});

test("right-clicking a group member in Details copies their number", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/");
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" }).click();
  await page.keyboard.press("Meta+i");
  await page.getByText("(619) 555-0104", { exact: true }).click({ button: "right" });
  await page.getByRole("dialog").getByText("Copy phone number", { exact: true }).click();
  expect(await clipboard(page)).toBe("(619) 555-0104");
});

test("a group message's menu copies the sender's number", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/");
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" }).click();
  await page.getByText("I added the revised run of show.", { exact: true }).click({ button: "right" });
  await page.getByRole("dialog").getByText("Copy Maya's number", { exact: true }).click();
  expect(await clipboard(page)).toBe("(619) 555-0104");
});
