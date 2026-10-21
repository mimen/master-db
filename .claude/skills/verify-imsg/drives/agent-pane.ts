import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { renderCounter, type Renders } from "../bench/renders";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (name: string) => join(evidence, `${name}.png`);
const DRAFT = "You're both on the list for Freaquency 10/31 🎃 see you there";
const VERBS = "Ran 3 commands, read 2 files, and 4 other actions";

type Call = { name: string; args: Record<string, unknown> };
function recordCalls(page: Page): Call[] {
  const calls: Call[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as Call;
    if (/^comma\/agent:(ask|answer|newChat|useDraft|stop)$/.test(body.name)) calls.push(body);
  });
  return calls;
}

/** A paste the way the browser delivers one: a ClipboardEvent carrying a DataTransfer. */
async function paste(input: Locator, content: { image?: { width: number; height: number; name: string }; text?: string }) {
  await input.evaluate(async (node, { image, text }) => {
    const data = new DataTransfer();
    if (image) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ff7a1a";
      context.fillRect(0, 0, image.width, image.height);
      context.fillStyle = "#1b1b1f";
      context.font = `bold ${Math.round(image.height / 5)}px sans-serif`;
      context.fillText("FREAQUENCY 10/31", image.width * 0.08, image.height * 0.58);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
      data.items.add(new File([blob], image.name, { type: "image/png" }));
    }
    if (text) data.setData("text/plain", text);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, content);
}

test("agent-pane: ⌘J asks, a question card answers, drafts land in the composer or the pane, New chat clears, the strip reports", async ({ desk }) => {
  test.setTimeout(90_000);
  const page = desk.page;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const calls = recordCalls(page);
  const convex = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await desk.request.post("/__fixture/convex", { data: { name, args } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<T>;
  };
  const liveItems = async () => {
    const chat = await convex<{ _id: string } | null>("comma/agent:liveChat", { conversationId: desk.chats.needs });
    return chat ? convex<Array<{ entry: { kind: string; placed?: string; used?: boolean } }>>("comma/agent:listItems", { chatId: chat._id }) : [];
  };

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  const composer = page.getByPlaceholder("iMessage");
  await expect(composer).toBeVisible();
  await composer.click();
  await page.screenshot({ path: shot("01-before") });

  const pane = page.getByTestId("agent-pane");
  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await page.keyboard.press("Meta+j");
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Agent", exact: true })).toBeVisible();
  await expect(pane.getByTestId("pane-header")).toContainText("Alex Rivera");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer).toBeFocused();
  await expect(pane).toBeVisible();
  await page.keyboard.press("Meta+j");
  await expect(input).toBeFocused();

  await input.fill("when did he first ask about tickets?");
  await input.press("Enter");
  await expect(pane.getByTestId("agent-user-message")).toHaveText("when did he first ask about tickets?");
  await expect(pane.getByTestId("agent-reply")).toContainText("Here is what the thread says.");
  await expect(pane.getByTestId("agent-reply").getByText("rebeccaberens@gmail.com")).toBeVisible();
  const turn = pane.getByTestId("agent-turn").first();
  await expect(turn.getByRole("button", { name: "Worked for 2m 5s · Opus 5.5" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Check the guest lists" })).toHaveCount(0);
  await expect(pane.getByTestId("agent-todos")).toContainText("Tasks · 3 of 3 done");
  await turn.getByRole("button", { name: "Worked for 2m 5s · Opus 5.5" }).click();
  await turn.getByRole("button", { name: VERBS }).click();
  await expect(turn).toContainText("Searched the thread for names and emails");
  await expect(turn).toContainText("Loaded auf skill");
  await turn.getByRole("button", { name: "Check the guest lists" }).click();
  const detail = turn.getByTestId("agent-step-detail").first();
  await expect(detail).toContainText("$ bun scripts/guest-list.ts --upcoming");
  const tick = detail.getByTestId("agent-step-output").getByText("✓");
  await expect(tick).toBeVisible();
  expect(await tick.evaluate((node) => getComputedStyle(node).color), "ANSI green renders as a colored span").not.toBe(
    await detail.getByTestId("agent-step-output").evaluate((node) => getComputedStyle(node).color));
  await expect(detail).not.toContainText("\u001b[");
  await turn.getByRole("button", { name: "Searched the thread for names and emails" }).click();
  await expect(turn.getByTestId("agent-step-detail").nth(1)).toContainText(/query\s*email/);
  await page.screenshot({ path: shot("02-reply-fold-verbs-detail") });

  await pane.getByRole("button", { name: "Copy reply" }).click();
  await expect(pane.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Here is what the thread says.");
  await pane.getByTestId("agent-code-block").getByRole("button", { name: "Copy code" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Freaquency 10/31: Jesse, Rebecca Berens");
  expect(calls.at(-1)).toMatchObject({ name: "comma/agent:ask", args: { text: "when did he first ask about tickets?", steer: false, model: "claude-opus-5-5", effort: "high" } });
  expect(String(calls.at(-1)!.args.key)).toMatch(/^ask-/);

  await input.fill("add them to the guest list");
  await input.press("Enter");
  const question = pane.getByTestId("agent-question");
  await expect(question).toContainText("Which list?");
  await expect(question.getByRole("radio", { name: "Freaquency 10/31" })).toBeVisible();
  await expect(question.getByRole("radio", { name: "Other" })).toBeVisible();
  await page.screenshot({ path: shot("03-question-card") });
  writeFileSync(join(evidence, "aria-question.txt"), await question.ariaSnapshot());
  await expect(input).toBeFocused();
  await page.keyboard.press("1");
  await expect(input).toHaveValue("");
  await expect.poll(() => calls.find((call) => call.name === "comma/agent:answer")?.args.answers).toEqual({ "Which list?": "Freaquency 10/31" });
  await expect(question).toContainText("Freaquency 10/31");
  await expect(question.getByRole("radio")).toHaveCount(0);

  await expect(composer).toHaveValue(DRAFT);
  await expect(page.getByTestId("draft-note")).toContainText("Added Jesse + Rebecca to Freaquency 10/31");
  await expect(pane.getByText("Put a reply in the composer")).toBeVisible();
  await page.screenshot({ path: shot("04-draft-in-composer") });

  await pane.getByRole("button", { name: "Close agent" }).click();
  await expect(pane).toHaveCount(0);
  const strip = page.getByTestId("agent-strip");
  await expect(strip).toContainText("Agent drafted a reply");
  await page.screenshot({ path: shot("05-strip-drafted") });
  await strip.click();
  await expect(pane).toBeVisible();
  await expect(strip).toHaveCount(0);

  await pane.getByRole("button", { name: "New chat" }).click();
  await expect(pane.getByTestId("agent-user-message")).toHaveCount(0);
  await expect(pane.getByText("Ask about Alex Rivera.", { exact: false })).toBeVisible();
  await expect.poll(liveItems).toEqual([]);
  await page.screenshot({ path: shot("06-new-chat") });

  await composer.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("hold on, checking");
  await expect.poll(async () => (await convex<{ text: string; source: string } | null>("comma/queries:getDraft", { conversationId: desk.chats.needs }))?.source).toBe("user");
  await page.keyboard.press("Meta+j");
  await input.fill("put both on the guest list");
  await input.press("Enter");
  await expect(question).toContainText("Which list?");
  await pane.getByRole("button", { name: "Close agent" }).click();
  await expect(strip).toContainText("Agent is asking you something");
  await page.screenshot({ path: shot("07-strip-asking") });
  await strip.click();
  await question.getByRole("radio", { name: "Freaquency 10/31" }).click();

  const draftCard = pane.getByTestId("agent-draft");
  await expect(draftCard).toContainText(DRAFT);
  await expect(composer).toHaveValue("hold on, checking");
  await page.screenshot({ path: shot("08-draft-card") });
  await draftCard.getByRole("button", { name: "Use in composer" }).click();
  await expect(composer).toHaveValue(DRAFT);
  await expect(draftCard.getByRole("button", { name: "In the composer" })).toBeDisabled();
  await expect.poll(async () => (await liveItems()).find((item) => item.entry.kind === "draft")?.entry).toMatchObject({ placed: "pane", used: true });
  await page.screenshot({ path: shot("09-used-in-composer") });

  await input.click();
  await expect(input).toHaveValue("");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("put both on the guest list");
  await page.keyboard.press("ArrowUp");
  await expect(input, "the oldest prompt stays put").toHaveValue("put both on the guest list");
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveValue("");
  await input.fill("first line\nsecond line");
  await page.keyboard.press("ArrowUp");
  await expect(input, "up on the last line of a draft moves the caret").toHaveValue("first line\nsecond line");
  await page.keyboard.press("ArrowUp");
  await expect(input, "up on the first line recalls").toHaveValue("put both on the guest list");
  await page.keyboard.press("ArrowDown");
  await expect(input, "down past the newest restores the draft").toHaveValue("first line\nsecond line");
  await input.fill("");
  writeFileSync(join(evidence, "aria.txt"), await pane.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ calls, items: await liveItems() }, null, 2));
});

test("agent-pane: a running turn ticks a status line without re-rendering the thread, shows its checklist, and Stop folds it", async ({ desk }) => {
  test.setTimeout(60_000);
  const page = desk.page;
  await page.addInitScript(renderCounter);
  const calls = recordCalls(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+j");
  const pane = page.getByTestId("agent-pane");
  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await input.fill("take your time and check every list");
  await input.press("Enter");

  const status = pane.getByTestId("agent-status");
  await expect(status).toContainText(/Working \ds/);
  await expect(status).toContainText("Reading the thread");
  const todos = pane.getByTestId("agent-todos");
  await expect(todos).toContainText("Tasks · 0 of 3 done");
  await expect(todos.getByLabel("Read the thread, in progress")).toContainText("Reading the thread");
  await expect(pane.getByTestId("agent-work")).toContainText("Used 1 tool and ran 1 command…");
  await page.screenshot({ path: shot("14-running-status") });

  const timer = async () => Number(/Working (\d+)s/.exec(await status.innerText())?.[1]);
  const before = await timer();
  await page.evaluate(() => {
    const w = window as unknown as { __renders: Renders };
    for (const key of Object.keys(w.__renders) as Array<keyof Renders>) w.__renders[key] = 0;
  });
  await expect.poll(timer, { timeout: 5_000 }).toBeGreaterThanOrEqual(before + 3);
  const renders = await page.evaluate(() => ({ ...(window as unknown as { __renders: Renders }).__renders }));
  writeFileSync(join(evidence, "status-tick-renders.json"), JSON.stringify(renders, null, 2));
  expect(renders.commits, "the timer committed while it ticked").toBeGreaterThanOrEqual(3);
  expect(renders.threadView, "ticking never re-renders the thread").toBe(0);
  expect(renders.composer, "ticking never re-renders the composer").toBe(0);
  expect(renders.bubbles + renders.rows + renders.cells, "ticking never re-renders a message").toBe(0);

  await pane.getByRole("button", { name: "Stop" }).click();
  await expect(pane.getByRole("button", { name: /^You stopped after \d/ })).toBeVisible();
  await expect(status).toHaveCount(0);
  await expect(pane.getByText("Stopped", { exact: true })).toHaveCount(0);
  expect(calls.map((call) => call.name)).toEqual(["comma/agent:ask", "comma/agent:stop"]);
  await page.screenshot({ path: shot("15-stopped-fold") });
  writeFileSync(join(evidence, "aria-stopped.txt"), await pane.ariaSnapshot());
});

test("agent-pane: a pasted image, a long paste and a dropped file go with an ask on the model picked in the input", async ({ desk }) => {
  test.setTimeout(60_000);
  const page = desk.page;
  const calls = recordCalls(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+j");
  const pane = page.getByTestId("agent-pane");
  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await expect(input).toBeFocused();

  await pane.getByRole("button", { name: "Model, Opus 5.5" }).click();
  await expect(page.getByRole("option")).toContainText(["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Sol", "Muse Wonder Full", "Luna"]);
  await page.getByRole("option", { name: "Sonnet 5.5" }).click();
  await expect(pane.getByRole("button", { name: "Effort, High" })).toBeVisible();
  await pane.getByRole("button", { name: "Effort, High" }).click();
  await page.getByRole("option", { name: "Low" }).click();
  await expect(pane.getByRole("button", { name: "Model, Sonnet 5.5" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Effort, Low" })).toBeVisible();

  await input.click();
  await paste(input, { image: { width: 2400, height: 1200, name: "flyer.png" } });
  await expect(pane.getByTestId("agent-staged-attachment")).toHaveCount(1);
  await paste(input, { text: "guest ".repeat(6_000) });
  await expect(input).toHaveValue("");
  await pane.getByTestId("agent-input-card").evaluate((card) => {
    const data = new DataTransfer();
    data.items.add(new File(["name,email\nRebecca,rebeccaberens@gmail.com\n"], "guests.csv", { type: "text/csv" }));
    for (const type of ["dragover", "drop"]) card.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  const staged = pane.getByTestId("agent-staged-attachment");
  await expect(staged).toHaveCount(3);
  await expect(staged.nth(1)).toHaveAccessibleName("pasted-text.txt");
  await expect(staged.nth(2)).toHaveAccessibleName("guests.csv");
  await pane.getByRole("button", { name: "Remove guests.csv" }).click();
  await expect(staged).toHaveCount(2);
  await page.screenshot({ path: shot("16-staged-attachments") });

  await input.fill("what does this flyer say?");
  await input.press("Enter");
  await expect(staged).toHaveCount(0);
  const message = pane.getByTestId("agent-user-message").last();
  await expect(message).toContainText("what does this flyer say?");
  await expect(message.locator("img")).toHaveCount(1);
  await expect(message.getByLabel("pasted-text.txt")).toBeVisible();
  await expect(pane.getByTestId("agent-reply")).toContainText("Here is what the thread says.");

  const ask = calls.find((call) => call.name === "comma/agent:ask")!;
  expect(ask.args).toMatchObject({
    text: "what does this flyer say?", model: "claude-sonnet-5-5", effort: "low",
    attachments: [{ filename: "flyer.png", mimeType: "image/png" }, { filename: "pasted-text.txt", mimeType: "text/plain", size: 36_000 }],
  });
  const flyer = (ask.args.attachments as Array<{ storageId: string; size: number }>)[0]!;
  const uploaded = await page.evaluate(async (storageId) => {
    const bitmap = await createImageBitmap(await (await fetch(`/__fixture/media/${storageId}`)).blob());
    return { width: bitmap.width, height: bitmap.height };
  }, flyer.storageId);
  expect(uploaded, "the image was downscaled to a 2000 px edge before upload").toEqual({ width: 2000, height: 1000 });
  const chat = await (await desk.request.post("/__fixture/convex", { data: { name: "comma/agent:liveChat", args: { conversationId: desk.chats.needs } } })).json() as { model: string; effort: string };
  expect(chat).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
  await expect(pane.getByRole("button", { name: "Model, Sonnet 5.5" })).toBeVisible();
  await page.screenshot({ path: shot("17-ask-with-attachments") });
  writeFileSync(join(evidence, "aria-attachments.txt"), await pane.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects-attachments.json"), JSON.stringify({ ask, uploaded, chat }, null, 2));
});

test("agent-pane: Settings turns the pane off, and with it ⌘J and the header button", async ({ desk }) => {
  const page = desk.page;
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  const composer = page.getByPlaceholder("iMessage");
  await composer.click();
  await expect(page.getByRole("button", { name: "Ask the agent (⌘J)" })).toBeVisible();

  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "Agent pane" }).click();
  await page.getByRole("option", { name: "Off" }).click();
  await expect(page.getByRole("button", { name: "Agent model" })).toContainText("Opus 5.5");
  await page.getByRole("button", { name: "Agent model" }).click();
  await expect(page.getByRole("option")).toContainText(["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Sol", "Muse Wonder Full", "Luna"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Agent effort" })).toContainText("High");
  await page.screenshot({ path: shot("10-settings-off") });
  await page.getByRole("button", { name: "Close settings" }).click();

  await composer.click();
  await page.keyboard.press("Meta+j");
  await expect(page.getByTestId("agent-pane")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask the agent (⌘J)" })).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test("agent-pane: below the three-column breakpoint the pane presents as the utility overlay", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("iMessage").click();
  await page.keyboard.press("Meta+j");
  await expect(page.getByTestId("agent-pane")).toBeVisible();
  await expect(page.getByTestId("desktop-utility-pane-content")).toHaveAttribute("data-utility-presentation", "overlay");
  await expect(page.getByRole("textbox", { name: "Ask the agent" })).toBeFocused();
  const opacity = () => page.getByTestId("agent-pane").evaluate((node) => {
    let value = 1;
    for (let el: Element | null = node; el; el = el.parentElement) value *= Number(getComputedStyle(el).opacity);
    return value;
  });
  await expect.poll(opacity).toBe(1);
  await page.screenshot({ path: shot("11-narrow-overlay") });
});

test("agent-pane: a runner that goes stale closes the pane for real, so ⌘W closes the conversation instead of the hidden pane", async ({ desk }) => {
  const page = desk.page;
  await page.clock.install();
  await page.goto(`/chat/${encodeURIComponent(desk.chats.needs)}`, { waitUntil: "domcontentloaded" });
  const composer = page.getByPlaceholder("iMessage");
  await composer.click();
  await page.keyboard.press("Meta+j");
  await expect(page.getByTestId("agent-pane")).toBeVisible();

  await page.clock.fastForward(130_000);
  await expect(page.getByTestId("agent-pane")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask the agent (⌘J)" })).toHaveCount(0);
  await page.screenshot({ path: shot("12-stale-runner-hides-pane") });

  await composer.click();
  await page.keyboard.press("Meta+w");
  await expect(page.getByTestId("thread-view")).toHaveCount(0);
  await page.screenshot({ path: shot("13-cmd-w-closes-conversation") });
});
