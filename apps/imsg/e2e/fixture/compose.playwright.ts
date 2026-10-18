import { expect, test } from "../fixtures/desk";

async function openCompose(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  await page.keyboard.press("Meta+n");
  const to = page.getByPlaceholder("Name, number, or email");
  await expect(to).toBeFocused();
  return to;
}

test("typing a space in a dialog's field keeps the dialog open", async ({ desk }) => {
  const page = desk.page;
  const to = await openCompose(page);
  await page.keyboard.type("Alex R", { delay: 40 });
  await expect(to).toHaveValue("Alex R");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("run of show", { delay: 40 });
  await expect(page.getByPlaceholder(/Search people and messages/)).toHaveValue("run of show");
});

test("a name with a space finds the person; Enter adds them and moves on to the message", async ({ desk }) => {
  const page = desk.page;
  await openCompose(page);
  await page.keyboard.type("alex riv", { delay: 30 });
  await expect(page.getByRole("dialog").getByText("Alex Rivera", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Alex Rivera" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByPlaceholder("Message")).toBeFocused();
});

test("Enter on a name with no match adds nothing; a full number gets its own row", async ({ desk }) => {
  const page = desk.page;
  const to = await openCompose(page);
  await to.fill("Zelda Q");
  await expect(page.getByText(/No one matches/)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  await to.fill("858 555 0123");
  await expect(page.getByRole("dialog").getByText("New number", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove 858 555 0123" })).toBeVisible();
});
