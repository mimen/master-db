import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (name: string) => join(evidence, `${name}.png`);

/** Bottom edge of the nearest ancestor that draws a bottom border: the header's hairline. */
const hairlineY = (locator: Locator) => locator.evaluate((node) => {
  for (let el: Element | null = node; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (parseFloat(style.borderBottomWidth) > 0) return { bottom: el.getBoundingClientRect().bottom, height: el.getBoundingClientRect().height };
  }
  return null;
});

test("agent-pane-shots: agent pane and Details beside the thread, light and dark, header hairlines measured", async ({ desk }) => {
  test.setTimeout(90_000);
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  const composer = page.getByPlaceholder("iMessage");
  await composer.click();

  const pane = page.getByTestId("agent-pane");
  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await page.keyboard.press("Meta+j");
  await expect(input).toBeFocused();
  await input.fill("when did he first ask about tickets?");
  await input.press("Enter");
  await expect(pane.getByTestId("agent-reply")).toContainText("Here is what the thread says.");
  await pane.getByTestId("agent-work").first().getByRole("button").click();
  await input.fill("add them to the guest list");
  await input.press("Enter");
  await expect(pane.getByTestId("agent-question")).toContainText("Which list?");
  await page.mouse.move(0, 0);

  const threadTitle = page.getByTestId("thread-view").getByRole("heading").first();
  const measures: Record<string, unknown> = {
    thread: await hairlineY(threadTitle),
    agent: await hairlineY(pane.getByTestId("pane-header")),
  };
  await page.screenshot({ path: shot("agent-light") });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("agent-dark") });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await pane.getByRole("button", { name: "Close agent" }).click();
  await expect(pane).toHaveCount(0);
  await composer.click();
  await page.keyboard.press("Meta+i");
  const close = page.getByRole("button", { name: "Close details" });
  await expect(close).toBeVisible();
  await page.mouse.move(0, 0);
  measures.details = await hairlineY(close);
  await page.screenshot({ path: shot("details-light") });
  writeFileSync(join(evidence, "header-hairlines.json"), JSON.stringify(measures, null, 2));
});
