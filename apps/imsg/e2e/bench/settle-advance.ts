/**
 * Presses ⌘E through the Needs you queue and reports, per press, which conversation was open
 * before and after. Stops at the first press that leaves the thread pane on "Select a conversation".
 * Prints the client's `imsg.triageTrace` at the end.
 *
 * Fixture only (it settles conversations). Scale the queue so the list paginates like a real inbox:
 *   FIXTURE_BACKLOG=300 IMSG_FIXTURE_PORT=8398 bun --no-env-file e2e/fixture/start.ts
 *   bun e2e/bench/settle-advance.ts --url http://127.0.0.1:8398/ [--engine webkit] [--gap 1200] [--mode plain|reply|glide]
 */
import { chromium, webkit } from "@playwright/test";
import { cachedChromium } from "../chromium";

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1] ?? fallback;
};
const url = arg("url", "http://127.0.0.1:8398/");
const gap = Number(arg("gap", "1200"));
const mode = arg("mode", "plain");
const presses = Number(arg("presses", "25"));

const browser = arg("engine", "chromium") === "webkit"
  ? await webkit.launch()
  : await chromium.launch({ executablePath: cachedChromium() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url);
const rows = page.getByTestId("conversation-row");
await rows.first().waitFor();
await page.waitForTimeout(3000);
await rows.first().click();
await page.waitForTimeout(800);
const empty = page.getByText("Select a conversation", { exact: true });
const open = async (): Promise<string> => decodeURIComponent(await page.evaluate(() => location.pathname));

let failed = false;
for (let i = 0; i < presses; i++) {
  const before = await open();
  if (mode === "reply") {
    await page.keyboard.type(`ok ${i}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
  if (mode === "glide") {
    await page.keyboard.press("Escape");
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Meta+e");
  await page.waitForTimeout(gap);
  const after = await open();
  failed = (await empty.isVisible()) || after === before;
  console.log(i, before, "->", after, failed ? "FAILED" : "");
  if (failed) break;
}
console.log(await page.evaluate(() => localStorage.getItem("imsg.triageTrace")));
await browser.close();
process.exit(failed ? 1 : 0);
