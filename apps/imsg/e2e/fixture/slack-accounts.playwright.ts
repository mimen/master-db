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
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const consent = await tab;
  await expect(consent.getByText("Slack is connected. You can close this tab.")).toBeVisible();
  await consent.close();

  await expect(page.getByText("AUF. Comma reads your DMs, group DMs and threads. Sending is coming.")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-settings-slack-connected.png", animations: "disabled" });

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByText("Disconnect", { exact: true }).last().click();
  await expect(page.getByText("AUF. Not connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
});
