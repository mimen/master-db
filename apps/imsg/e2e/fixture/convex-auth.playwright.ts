import { expect, test } from "../fixtures/desk";

test("desktop leaves chats ungated and directs sign-in to the web app", async ({ desk }) => {
  await desk.page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(desk.page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await desk.page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(desk.page.getByText("Sign in from the web app for now")).toBeVisible();
  await expect(desk.page.getByRole("button", { name: "Sign in to Convex", exact: true })).toHaveCount(0);
  await expect(desk.page.getByText("Sign-in is optional. Messages use the existing connection.")).toBeVisible();
  await expect(desk.page.getByRole("switch", { name: "Read messages from Convex", exact: true })).toHaveCount(0);
  await expect(desk.page.getByRole("switch", { name: "Send through Convex", exact: true })).toHaveCount(0);
  await desk.page.screenshot({ path: "/tmp/comma-convex-desktop-settings.png", animations: "disabled" });
});

test("web offers optional sign-in without sending fixture traffic to Convex", async ({ page, request }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".convex.") || request.url().includes("comma-fixture.invalid")) requests.push(request.url());
  });
  await request.post("/__fixture/reset");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const signIn = page.getByRole("button", { name: "Sign in to Convex", exact: true });
  await expect(signIn).toBeEnabled();
  await expect(page.getByText("Sign-in is optional. Messages use the existing connection.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Read messages from Convex", exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Send through Convex", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-convex-web-settings.png", animations: "disabled" });
  await signIn.click();
  await expect(page.getByText("Could not sign in to Convex", { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
});
