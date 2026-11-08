import { expect, test } from "../fixtures/desk";

test("Mail lists the inbox under People and All inbox, and newsletters never reach People", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  // Email threads list in Mail only.
  await expect(page.getByText("Load-in for Saturday")).toHaveCount(0);

  await page.getByRole("button", { name: "Mail", exact: true }).click();
  const list = page.getByTestId("mail-list");
  await expect(page.getByRole("tab", { name: "People, 1" })).toHaveAttribute("aria-selected", "true");
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();
  await expect(list.getByText("This week at the club")).toHaveCount(0);
  await expect(list.getByText("Booking inquiry")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-mail-workspace.png", animations: "disabled" });

  await page.getByRole("button", { name: "2 more in All inbox" }).click();
  await expect(page.getByRole("tab", { name: "All inbox, 3" })).toHaveAttribute("aria-selected", "true");
  await expect(list.getByText("This week at the club")).toBeVisible();
  await expect(list.getByText("Booking inquiry")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-mail-all-inbox.png", animations: "disabled" });
});

test("the reader shows each message as a card, and a message with a script and a tracking pixel renders with neither", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sam Lee, Load-in for Saturday" }).click();

  const reader = page.getByTestId("email-reader");
  await expect(reader.getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  await expect(reader.getByText("What time is load-in?")).toBeVisible();
  await expect(reader.getByText("Sending from Gmail is coming")).toBeVisible();

  const frame = reader.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  const body = page.frameLocator('[data-testid="email-reader"] iframe').locator("body");
  await expect(body.getByText("Load-in is at 6 pm, doors at 8.")).toBeVisible();
  await expect(body.locator("script")).toHaveCount(0);
  await expect(body.locator('img[src*="track.example.test"], img[data-comma-src*="track.example.test"]')).toHaveCount(0);
  await expect(body.locator("img[src]")).toHaveCount(0);
  await expect(body.getByRole("link", { name: "Advance sheet" })).toHaveAttribute("target", "_blank");
  expect(await frame.evaluate((element) => (element as HTMLIFrameElement).srcdoc)).not.toMatch(/<script|onload=|open\.gif/);
  expect(await page.evaluate(() => ({ script: (globalThis as { __mailScript?: boolean }).__mailScript, onload: (globalThis as { __mailOnload?: boolean }).__mailOnload })))
    .toEqual({ script: undefined, onload: undefined });
  await page.screenshot({ path: "/tmp/comma-email-reader.png", animations: "disabled" });
  await frame.screenshot({ path: "/tmp/comma-email-sanitized.png", animations: "disabled" });

  await reader.getByRole("button", { name: /Load images/ }).click();
  await expect(body.locator('img[src="https://cdn.example.test/floor-plan.png"]')).toHaveCount(1);
  await expect(body.locator('img[src*="track.example.test"]')).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(requested.filter((url) => url.includes("track.example.test"))).toEqual([]);
});

test("on a phone, Mail is a tab whose reader opens in place and goes back", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("phone-tab-bar").getByRole("tab", { name: "Mail" }).click();
  await page.getByRole("button", { name: "Sam Lee, Load-in for Saturday" }).click();
  await expect(page.getByTestId("email-card")).toHaveCount(2);
  await page.screenshot({ path: "/tmp/comma-mail-phone.png", animations: "disabled" });
  await page.getByRole("button", { name: "Back to Mail" }).click();
  await expect(page.getByRole("tab", { name: "People, 1" })).toBeVisible();
});

test("with a mailbox connected, search offers a Gmail chip whose hits open in Mail", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const tab = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  await (await tab).close();

  await page.goto("/search", { waitUntil: "domcontentloaded" });
  const chips = page.getByRole("radiogroup", { name: "Search in" });
  await expect(chips.getByRole("radio")).toHaveText(["Everywhere", "iMessage", "Gmail"]);
  await page.getByPlaceholder("Search contacts and messages…").fill("load-in");
  await chips.getByRole("radio", { name: "Gmail" }).click();
  await page.getByText("Hi Milad, Load-in is at 6 pm, doors at 8.").first().click();
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();
  await expect(page.getByTestId("email-card")).toHaveCount(2);
});
