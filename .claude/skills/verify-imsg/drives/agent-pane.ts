import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (name: string) => join(evidence, `${name}.png`);
const DRAFT = "You're both on the list for Freaquency 10/31 🎃 see you there";

test("agent-pane: ⌘J asks, a question card answers, drafts land in the composer or the pane, New chat clears, the strip reports", async ({ desk }) => {
  test.setTimeout(90_000);
  const page = desk.page;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name: string; args: Record<string, unknown> };
    if (/^comma\/agent:(ask|answer|newChat|useDraft)$/.test(body.name)) calls.push(body);
  });
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
  const work = pane.getByTestId("agent-work").first();
  await expect(work).toContainText(/Worked for (<1|\d+)s · 2 steps/);
  await work.getByRole("button").click();
  await expect(work).toContainText("Searched the thread for names and emails");
  await page.screenshot({ path: shot("02-reply-markdown-worklog") });
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
  writeFileSync(join(evidence, "aria.txt"), await pane.ariaSnapshot());
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify({ calls, items: await liveItems() }, null, 2));
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
