import { mkdirSync } from "node:fs";
import { expect, test } from "../fixtures/desk";

test.use({
  launchOptions: async ({ launchOptions }, use) => {
    await use({ ...launchOptions, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  },
});

mkdirSync("/tmp/comma-ui-batch-e/after", { recursive: true });

test("web mic: click toggles, short take and Esc send nothing, explicit send uploads", async ({ desk }) => {
  const page = desk.page;
  await page.context().grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    const uploads = { count: 0 };
    (window as unknown as { __uploads: typeof uploads }).__uploads = uploads;
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/attachment") && init?.method === "POST") {
        uploads.count++;
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return realFetch(input, init);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?voice", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Needs reply" })).toBeVisible();
  await page.getByTestId("conversation-row").first().click();
  const mic = page.getByRole("button", { name: "Record voice message" });
  await page.getByPlaceholder("iMessage").fill("labelled");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await page.getByPlaceholder("iMessage").fill("");
  const sendVoice = page.getByRole("button", { name: "Send voice message" });
  const uploads = () => page.evaluate(() => (window as unknown as { __uploads: { count: number } }).__uploads.count);

  await mic.click();
  await expect(sendVoice).toBeVisible();
  await sendVoice.click();
  await expect(mic).toBeVisible();
  expect(await uploads(), "a click-length take is discarded").toBe(0);

  await mic.click();
  await expect(sendVoice).toBeVisible();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await expect(mic).toBeVisible();
  await expect(page.getByTestId("thread-view")).toBeVisible();
  expect(await uploads(), "Esc cancels").toBe(0);

  await mic.click();
  await page.waitForTimeout(1200);
  await expect(page.getByText("0:01", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-ui-batch-e/after/voice-recording-desk.png" });
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await expect(mic).toBeVisible();
  expect(await uploads(), "Cancel button cancels").toBe(0);

  await mic.click();
  await page.waitForTimeout(800);
  await sendVoice.click();
  await expect.poll(uploads).toBe(1);
});
