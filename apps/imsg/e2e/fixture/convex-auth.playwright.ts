import { expect, test } from "../fixtures/desk";

test("chats load without a Convex settings section or sign-in row", async ({ desk }) => {
  await desk.page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(desk.page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await desk.page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(desk.page.getByText("Settings", { exact: true }).last()).toBeVisible();
  await expect(desk.page.getByText("Convex", { exact: true })).toHaveCount(0);
  await expect(desk.page.getByText("Sign in from the web app for now")).toHaveCount(0);
  await expect(desk.page.getByRole("button", { name: "Sign in to Convex", exact: true })).toHaveCount(0);
  await expect(desk.page.getByText("Sign-in is optional. Messages use the existing connection.")).toHaveCount(0);
  await expect(desk.page.getByRole("switch", { name: "Read messages from Convex", exact: true })).toHaveCount(0);
  await expect(desk.page.getByRole("switch", { name: "Send through Convex", exact: true })).toHaveCount(0);
  await desk.page.screenshot({ path: "/tmp/comma-convex-settings.png", animations: "disabled" });
});
