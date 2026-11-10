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
  await expect(page.getByRole("dialog", { name: "New message" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New message" })).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  // The palette loads on its first open; compose no longer lives in it, so this is that first open.
  await expect(page.getByPlaceholder(/Search people and messages/)).toBeFocused();
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
  await expect(page.getByRole("button", { name: "Remove (858) 555-0123 from To" })).toBeVisible();
});

test("compose-sheet: Esc closes an empty sheet and asks before discarding a written one", async ({ desk }) => {
  const page = desk.page;
  await openCompose(page);
  const sheet = page.getByRole("dialog", { name: "New message" });
  await expect(sheet.getByRole("heading", { name: "New message" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Close New message" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await openCompose(page);
  await page.keyboard.type("alex riv", { delay: 30 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("See you at six");
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("alert")).toHaveText("Discard what you wrote?");
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(sheet.getByLabel("Message", { exact: true })).toHaveValue("See you at six");
  await sheet.getByRole("button", { name: "Close New message" }).click();
  await sheet.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
});

test("compose-sheet: Forward has a title, one To label, and sends to the chat picked into To", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByTestId("thread-view").getByRole("button", { name: /^Alex Rivera: / }).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Forward" }).click();
  const sheet = page.getByRole("dialog", { name: "Forward message" });
  await expect(sheet.getByText("Forward message", { exact: true })).toBeVisible();
  await expect(sheet.getByText("To", { exact: true })).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.keyboard.type("Jordan", { delay: 20 });
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("button", { name: "Remove Jordan Lee from To" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("thread-view").getByRole("button", { name: /^You: / }).last()).toBeVisible();
});

test("compose-sheet: on a phone, New message fills the screen with a back button and the footer", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/new-chat", { waitUntil: "domcontentloaded" });
  const back = page.getByRole("button", { name: "Close New message" });
  await expect(back).toBeVisible();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeVisible();
  const box = await send.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(780);
  await back.click();
  await expect(page).not.toHaveURL(/new-chat/);
});
