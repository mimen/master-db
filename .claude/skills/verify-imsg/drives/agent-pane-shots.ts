import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { AGENT_CHAT_GUIDS } from "./world";

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
  await pane.getByTestId("agent-turn").first().getByRole("button").first().click();
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

/** Light then dark, of the pane alone so the transcript reads at full size. */
async function both(page: Page, pane: Locator, name: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.waitForTimeout(250);
    await pane.screenshot({ path: shot(`batch2-${name}-${scheme}`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

test("agent-pane-shots: batch 2 in light and dark, running, stopped, and finished with an attachment on a switched model", async ({ desk }) => {
  test.setTimeout(90_000);
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+j");
  const pane = page.getByTestId("agent-pane");
  const input = page.getByRole("textbox", { name: "Ask the agent" });

  await input.fill("take your time and check every list");
  await input.press("Enter");
  await expect(pane.getByTestId("agent-status")).toContainText("Reading the thread");
  await page.waitForTimeout(2_200);
  await both(page, pane, "running");

  await pane.getByRole("button", { name: "Stop" }).click();
  const stopped = pane.getByRole("button", { name: /^You stopped after/ });
  await stopped.click();
  await both(page, pane, "stopped");

  await pane.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(pane.getByTestId("agent-user-message")).toHaveCount(0);
  await pane.getByRole("button", { name: "Model, Opus 5.5" }).click();
  await page.getByRole("option", { name: "Sonnet 5.5" }).click();
  await input.click();
  await input.evaluate(async (node) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff7a1a";
    context.fillRect(0, 0, 1600, 1000);
    context.fillStyle = "#1b1b1f";
    context.font = "bold 180px sans-serif";
    context.fillText("10/31", 420, 580);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "flyer.png", { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(pane.getByTestId("agent-staged-attachment")).toHaveCount(1);
  await input.fill("who is on the list for this one?");
  await both(page, pane, "staged");
  await input.press("Enter");
  const turn = pane.getByTestId("agent-turn").first();
  await expect(turn.getByRole("button", { name: "Worked for 2m 5s · Sonnet 5.5" })).toBeVisible();
  const newChat = pane.getByRole("button", { name: "New chat", exact: true });
  await expect(newChat).toBeEnabled();
  expect(await newChat.evaluate((node) => getComputedStyle(node).outlineStyle), "New chat, re-enabled after a pointer click, draws no focus ring").toBe("none");
  await both(page, pane, "folded");

  await turn.getByRole("button", { name: "Worked for 2m 5s · Sonnet 5.5" }).click();
  await turn.getByRole("button", { name: "Ran 3 commands, read 2 files, and 4 other actions" }).click();
  await turn.getByRole("button", { name: "Check the guest lists" }).click();
  await turn.getByRole("button", { name: "Searched the thread for names and emails" }).click();
  await expect(turn.getByTestId("agent-step-output").first()).toContainText("2 spots left");
  await both(page, pane, "expanded");
});

/** Light then dark of the pane's area, menus included, so a switcher reads at full size. */
async function bothArea(page: Page, pane: Locator, name: string, blur = true) {
  await page.mouse.move(0, 0);
  if (blur) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const box = (await pane.boundingBox())!;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot(`batch3-${name}-${scheme}`), clip: box });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

test("agent-pane-shots: batch 3 in light and dark, the switcher, a chat working elsewhere, a settled chat, the strip chips and the phone", async ({ desk }) => {
  test.setTimeout(120_000);
  const page = desk.page;
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const guid = AGENT_CHAT_GUIDS.several;
  await page.goto(`/chat/${encodeURIComponent(guid)}`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+j");
  const pane = page.getByTestId("agent-pane");
  const switcher = pane.getByRole("button", { name: /^Agent chat, / });
  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await expect(switcher).toHaveAccessibleName("Agent chat, Rideshare codes");
  await bothArea(page, pane, "pane-header");
  await switcher.click();
  await expect(page.getByRole("option")).toHaveCount(5);
  await bothArea(page, pane, "switcher", false);

  await page.getByRole("option", { name: /Hotel block for the crew/ }).click();
  await input.fill("take your time and check every hotel nearby");
  await input.press("Enter");
  await expect(pane.getByTestId("agent-status")).toContainText(/Working \ds/);
  await pane.getByRole("button", { name: "New chat", exact: true }).click();
  await page.waitForTimeout(2_200);
  await switcher.click();
  await expect(page.getByRole("option", { name: /Hotel block for the crew/ })).toHaveText(/\ds$/);
  await bothArea(page, pane, "switcher-working-elsewhere", false);
  await page.keyboard.press("Escape");

  await switcher.click();
  await page.getByRole("option", { name: /Leah's birthday dinner/ }).click();
  await expect(pane.getByTestId("agent-settled-bar")).toBeVisible();
  await bothArea(page, pane, "settled-chat");

  const chips = [
    [AGENT_CHAT_GUIDS.needsYou, "asking"], [AGENT_CHAT_GUIDS.working, "working"], [AGENT_CHAT_GUIDS.ready, "drafted"],
    [AGENT_CHAT_GUIDS.several, "replied"], [AGENT_CHAT_GUIDS.failed, "failed"],
  ] as const;
  await pane.getByRole("button", { name: "Close agent" }).click();
  for (const [chat, name] of chips) {
    await page.goto(`/chat/${encodeURIComponent(chat)}`, { waitUntil: "domcontentloaded" });
    const strip = page.getByTestId("state-strip");
    await expect(strip.getByTestId("agent-strip")).toBeVisible();
    await page.mouse.move(0, 0);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.waitForTimeout(200);
      await strip.screenshot({ path: shot(`batch3-strip-${name}-${scheme}`) });
    }
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/chat/${encodeURIComponent(AGENT_CHAT_GUIDS.needsYou)}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("agent-strip").click();
  const phonePane = page.getByTestId("agent-pane");
  await expect(phonePane.getByRole("button", { name: "Agent chat, Load-in time for Saturday" })).toBeVisible();
  await page.mouse.move(0, 0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot(`batch3-phone-${scheme}`) });
  }
});
