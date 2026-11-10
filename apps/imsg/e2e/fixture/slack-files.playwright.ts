import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, openView } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-slack-files-"));

test("slack-files: a Slack image draws inline and opens in the lightbox, a file is a tile, and one Slack wouldn't share still shows its name", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/slack", { data: { seedFiles: true } });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openView(page, "All");
  await page.getByTestId("conversation-row").filter({ hasText: "Sam Lee" }).click();

  const thread = page.getByTestId("thread-view");
  await expect(thread.getByText("Flyer and rider for Saturday")).toBeVisible();
  const photo = thread.getByRole("button", { name: "Open photo", exact: true });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: "the flyer paints from its stored copy" }).toBe(true);
  await expect(thread.getByRole("link", { name: /^rider\.pdf, .+\. Click to download$/ })).toBeVisible();
  await expect(thread.getByLabel(/^partner-deck\.key, .+\. Unavailable$/)).toBeVisible();
  await expect(thread.getByText("Media pending or unavailable")).toHaveCount(0);
  await page.screenshot({ path: join(evidence, "1-slack-files-inline.png") });

  await photo.click();
  await expect(page.getByRole("button", { name: "Close viewer", exact: true })).toBeVisible();
  await expect(page.getByLabel("Media unavailable")).toHaveCount(0);
  const full = page.locator('img[src$="/__fixture/slack-file/flyer.png"]');
  await expect(full, "the bubble's copy and the lightbox's").toHaveCount(2);
  await expect.poll(() => full.last().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: join(evidence, "2-slack-image-lightbox.png") });
});
