import { expect, test } from "../fixtures/desk";

test("Settings connects Slack in a new tab and disconnects it after a confirm", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();

  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByText("Through the Mac mini.")).toBeVisible();
  await expect(page.getByText("Read your AUF DMs, group DMs and threads in Comma.")).toBeVisible();

  const tab = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Connect Slack", exact: true }).click();
  const consent = await tab;
  await expect(consent.getByText("Slack is connected. You can close this tab.")).toBeVisible();
  await consent.close();

  await expect(page.getByText("AUF. Comma reads your DMs, group DMs, threads and the channels you follow.")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-settings-slack-connected.png", animations: "disabled" });

  await page.getByRole("button", { name: "Disconnect Slack", exact: true }).click();
  await page.getByText("Disconnect", { exact: true }).last().click();
  await expect(page.getByText("AUF. Not connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Slack", exact: true })).toBeVisible();
});

test("Settings connects Gmail in a new tab and disconnects it after a confirm", async ({ desk }) => {
  const page = desk.page;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByText("Read your AUF mailbox in Comma's Mail.")).toBeVisible();

  const tab = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  const consent = await tab;
  await expect(consent.getByText("Gmail is connected. You can close this tab.")).toBeVisible();
  await consent.close();

  await expect(page.getByText("milad@afternoonumbrellafriends.com. Comma reads your inbox. Replying and archiving from Comma are coming.")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-settings-gmail-connected.png", animations: "disabled" });
  // Slack's row is untouched by Gmail's.
  await expect(page.getByRole("button", { name: "Connect Slack", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect Gmail", exact: true }).click();
  await page.getByText("Disconnect", { exact: true }).last().click();
  await expect(page.getByText("milad@afternoonumbrellafriends.com. Not connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Gmail", exact: true })).toBeVisible();
});
