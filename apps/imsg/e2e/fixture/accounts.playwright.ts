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

  await expect(page.getByText("milad@afternoonumbrellafriends.com. Comma reads your inbox, and replies, forwards and archives from it.")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-settings-gmail-connected.png", animations: "disabled" });
  // Slack's row is untouched by Gmail's.
  await expect(page.getByRole("button", { name: "Connect Slack", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect Gmail", exact: true }).click();
  await page.getByText("Disconnect", { exact: true }).last().click();
  await expect(page.getByText("milad@afternoonumbrellafriends.com. Not connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Gmail", exact: true })).toBeVisible();
});

test("a gmail.com mailbox connects beside the AUF one, counts down to its weekly reconnect, and gets its own Mail chip", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByText("Read your gmail.com mailbox in Comma's Mail. Google asks you to reconnect it every week.")).toBeVisible();

  for (const name of ["Connect Gmail", "Connect Personal Gmail"]) {
    const tab = page.context().waitForEvent("page");
    await page.getByRole("button", { name, exact: true }).click();
    await (await tab).close();
  }
  await expect(page.getByText("miladmaaan@gmail.com. Comma reads your inbox. Reconnect within 5 days, Google's weekly limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect Gmail", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-settings-personal-gmail.png", animations: "disabled" });

  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  const mailboxes = page.getByRole("tablist", { name: "Mailbox" });
  await expect(mailboxes.getByRole("tab")).toHaveText(["All", "AUF", "Personal"]);
  await expect(page.getByTestId("mail-list").getByText("Load-in for Saturday")).toBeVisible();
  await mailboxes.getByRole("tab", { name: "Personal" }).click();
  await expect(page.getByRole("tab", { name: "People, 0" })).toBeVisible();
  await expect(page.getByTestId("mail-list").getByText("Load-in for Saturday")).toHaveCount(0);
  await mailboxes.getByRole("tab", { name: "AUF" }).click();
  await expect(page.getByTestId("mail-list").getByText("Load-in for Saturday")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-mail-two-mailboxes.png", animations: "disabled" });
});
