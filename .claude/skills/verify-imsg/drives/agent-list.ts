import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { AGENT_CHAT_GUIDS } from "./world";

const evidence = process.env.VERIFY_IMSG_EVIDENCE!;
const shot = (name: string) => join(evidence, `${name}.png`);
const SIDEBAR = { x: 0, y: 0, width: 352, height: 900 };

type Summary = { _id: string; conversationId: string; state: string; settledAt?: number };

const GROUPS = new Set(["Needs you", "Failed", "Ready", "Working", "Open", "Today", "This week", "Older"]);
/** The sidebar's group headers and rows, top to bottom. */
const listOrder = async (page: Page) => (await page.locator('[role="heading"], [data-testid="conversation-row"]').evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("data-testid") === "conversation-row" ? (node.getAttribute("aria-label") ?? "").split(",")[0]! : `# ${node.textContent}`)))
  .filter((entry) => !entry.startsWith("# ") || GROUPS.has(entry.slice(2)));

/** The color the row's age is drawn in: the innermost text that reads like "9w". */
const ageColor = (row: Locator) => row.getByText(/^\d+[mhdwy]$/).last().evaluate((node) => getComputedStyle(node).color);

test("agent-list: badges in every lens, agent rows in Needs you, the Agents tab, settle carries the chats, the pane opens itself, toasts and ⌘K", async ({ desk }) => {
  test.setTimeout(150_000);
  const page = desk.page;
  const convex = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await desk.request.post("/__fixture/convex", { data: { name, args } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<T>;
  };
  const enqueued: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/__fixture/convex")) return;
    const body = request.postDataJSON() as { name?: string; args?: { payload?: { kind?: string } } } | null;
    if (body?.name === "comma/outbox:enqueue" && body.args?.payload?.kind) enqueued.push(body.args.payload.kind);
  });
  const effects: Record<string, unknown> = {};
  const rows = page.getByTestId("conversation-row");
  const row = (name: string) => rows.filter({ hasText: name });
  const lens = (name: RegExp) => page.getByRole("tab", { name });
  const pane = page.getByTestId("agent-pane");
  const closePane = async () => {
    if (await pane.isVisible()) await page.getByRole("button", { name: "Close agent" }).click();
    await expect(pane).toBeHidden();
  };

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await lens(/^All/).click();
  const badges: [string, string][] = [
    ["Diego Santos", "agent needs you"], ["Priya Shah", "agent failed"], ["Riley Chen", "agent finished"],
    ["Taylor Morgan", "agent working"], ["Marcus Reed", "agent chat open"], ["Leah Kim", "agent finished"],
  ];
  for (const [name, spoken] of badges) {
    await expect(row(name), `${name} says ${spoken}`).toHaveAttribute("aria-label", new RegExp(`^${name}, (unread, )?${spoken}, `));
    await expect(row(name).getByTestId("agent-badge")).toBeVisible();
  }
  await expect(row("Alex Rivera").getByTestId("agent-badge"), "no agent chat, no badge").toHaveCount(0);
  await page.screenshot({ path: shot("01-all-light"), clip: SIDEBAR });

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await lens(/^All/).click();
  await expect(row("Taylor Morgan").getByTestId("agent-badge")).toBeVisible();
  await page.screenshot({ path: shot("02-all-dark-turning-ring"), clip: SIDEBAR });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });

  // Marcus's chat is open, not wanting the user: opening him leaves the pane shut.
  await lens(/^All/).click();
  await row("Marcus Reed").click();
  await expect(page.getByTestId("thread-view")).toContainText("Marcus Reed");
  await expect(pane, "an open chat does not open the pane").toBeHidden();
  const needsBefore = await lens(/^Needs you/).getAttribute("aria-label");
  const composer = page.getByPlaceholder("iMessage");
  await composer.fill("Ninety minutes works");
  await composer.press("Enter");
  await expect(row("Marcus Reed")).toContainText("You: Ninety minutes works");
  await row("Alex Rivera").click();
  await lens(/^Needs you/).click();
  await expect(row("Marcus Reed"), "replied to, still in Needs you for its agent chat").toBeVisible();
  await expect(lens(/^Needs you/)).toHaveAttribute("aria-label", needsBefore!);
  const marcusAge = await ageColor(row("Marcus Reed"));
  const alexAge = await ageColor(row("Alex Rivera"));
  expect(marcusAge, "a row there only for its agent keeps a gray time").not.toBe(alexAge);
  effects.needsReply = { tab: needsBefore, marcusAge, alexAge };
  await page.screenshot({ path: shot("03-needs-reply-agent-row"), clip: SIDEBAR });

  await lens(/^Agents/).click();
  await expect(lens(/^Agents/)).toHaveAttribute("aria-label", "Agents, 4");
  await expect.poll(() => listOrder(page)).toEqual([
    "# Needs you", "Diego Santos", "# Failed", "Priya Shah", "# Ready", "Riley Chen", "Leah Kim",
    "# Working", "Taylor Morgan", "# Open", "Marcus Reed",
  ]);
  await expect(row("Diego Santos")).toContainText("Load-in time for Saturday");
  await expect(row("Diego Santos")).toContainText("Needs you · Which load-in time should I give Diego?");
  await expect(row("Priya Shah")).toContainText("Failed · The gateway timed out after 120 s.");
  await expect(row("Riley Chen")).toContainText("Draft ready · You're on the list for Friday, see you there");
  await expect(row("Leah Kim")).toContainText("Rideshare codes · 2 chats");
  await expect(row("Taylor Morgan")).toContainText("Working · Searching the thread");
  await expect(row("Marcus Reed")).toContainText("Marcus plays 90 minutes, 11 to 12:30.");
  writeFileSync(join(evidence, "aria-agents.txt"), [
    await page.getByRole("tablist").first().ariaSnapshot(),
    ...await rows.evaluateAll((nodes) => nodes.map((node) => `- row "${node.getAttribute("aria-label")}"`)),
  ].join("\n"));
  await page.screenshot({ path: shot("04-agents-light"), clip: SIDEBAR });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({ path: shot("05-agents-dark"), clip: SIDEBAR });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  // In the Agents lens any pick opens the pane, working chats included.
  await row("Taylor Morgan").click();
  await expect(pane, "an Agents lens pick opens the pane").toBeVisible();
  await expect(pane.getByTestId("pane-header")).toContainText("Venues Taylor mentioned");
  await closePane();

  await lens(/^All/).click();
  await row("Alex Rivera").click();
  await expect(pane).toBeHidden();
  await row("Riley Chen").click();
  await expect(pane, "selecting a conversation whose agent is ready opens the pane").toBeVisible();
  await expect(pane.getByTestId("pane-header")).toContainText("Reply about the guest list");
  await expect(composer, "focus stays in the composer").toBeFocused();
  await page.screenshot({ path: shot("06-auto-open-riley") });
  await closePane();

  // The runner finishing Taylor's turn, simulated through the fixture's scripted agent.
  await row("Alex Rivera").click();
  const open = await convex<Summary[]>("comma/agent:listAgentChats", {});
  const taylor = open.find((chat) => chat.conversationId === AGENT_CHAT_GUIDS.working)!;
  await convex("comma/agent:ask", {
    conversationId: AGENT_CHAT_GUIDS.working, chatId: taylor._id, key: "agent-list-finish", text: "wrap up", steer: true, model: "claude-opus-5-5", effort: "high",
  });
  const toast = page.getByText("Taylor Morgan · agent finished");
  await expect(toast, "a finished chat elsewhere toasts").toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shot("07-toast") });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("thread-view")).toContainText("Taylor Morgan");
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId("pane-header")).toContainText("Venues Taylor mentioned");
  await page.screenshot({ path: shot("08-toast-open") });
  await closePane();

  const shell = page.getByTestId("desktop-shell");
  await row("Alex Rivera").click();
  await page.keyboard.press("Meta+,");
  await expect(shell).toHaveAttribute("data-utility-kind", "settings");
  await row("Diego Santos").click();
  await expect(page.getByTestId("thread-view")).toContainText("Diego Santos");
  await expect(shell, "walking onto Diego leaves Settings open").toHaveAttribute("data-utility-kind", "settings");
  await expect(pane).toBeHidden();
  await page.screenshot({ path: shot("16-settings-stays") });
  await row("Alex Rivera").click();
  await page.keyboard.press("Meta+,");
  await expect(shell).toHaveAttribute("data-utility-kind", "");

  await lens(/^Needs you/).click();
  await row("Diego Santos").click();
  await expect(pane, "a question opens the pane").toBeVisible();
  await page.screenshot({ path: shot("09-before-settle"), clip: SIDEBAR });
  await page.keyboard.press("Meta+e");
  await expect(row("Diego Santos"), "⌘E takes Diego out of Needs you").toHaveCount(0);
  await expect.poll(async () => (await convex<Summary[]>("comma/agent:chatsFor", { conversationId: AGENT_CHAT_GUIDS.needsYou }))
    .map((chat) => chat.settledAt !== undefined)).toEqual([true]);
  effects.settled = await convex<Summary[]>("comma/agent:chatsFor", { conversationId: AGENT_CHAT_GUIDS.needsYou });
  await page.screenshot({ path: shot("10-settled"), clip: SIDEBAR });
  await lens(/^All/).click();
  await row("Diego Santos").hover();
  await page.getByRole("button", { name: "Un-settle Diego Santos" }).click();
  await lens(/^Needs you/).click();
  await expect(row("Diego Santos"), "Un-settle brings Diego back with his chat").toBeVisible();
  await expect(row("Diego Santos").getByTestId("agent-badge")).toBeVisible();
  await expect.poll(async () => (await convex<Summary[]>("comma/agent:chatsFor", { conversationId: AGENT_CHAT_GUIDS.needsYou }))
    .map((chat) => chat.settledAt)).toEqual([undefined]);
  effects.unsettled = await convex<Summary[]>("comma/agent:chatsFor", { conversationId: AGENT_CHAT_GUIDS.needsYou });
  effects.enqueued = enqueued;
  expect(enqueued).toEqual(expect.arrayContaining(["settle", "unsettle"]));
  await page.screenshot({ path: shot("11-unsettled"), clip: SIDEBAR });
  await closePane();

  type Chat = Summary & { title: string };
  const leahChats = () => convex<Chat[]>("comma/agent:chatsFor", { conversationId: AGENT_CHAT_GUIDS.several });
  const finish = async (chatId: string, key: string) => {
    await convex("comma/agent:ask", { conversationId: AGENT_CHAT_GUIDS.several, chatId, key, text: "wrap up", steer: true, model: "claude-opus-5-5", effort: "high" });
    await expect.poll(async () => (await leahChats()).find((chat) => chat._id === chatId)?.state).toBe("idle");
  };
  await lens(/^All/).click();
  await row("Leah Kim").click();
  await expect(pane.getByTestId("pane-header")).toContainText("Rideshare codes");
  const titled = async (title: string) => (await leahChats()).find((chat) => chat.title === title)!;
  const rideshare = await titled("Rideshare codes");
  const hotel = await titled("Hotel block for the crew");
  const leahToast = page.getByText("Leah Kim · agent finished");
  await finish(rideshare._id, "agent-list-rideshare");
  await page.waitForTimeout(1_000);
  await expect(leahToast, "the chat the pane shows finishing is no news").toHaveCount(0);
  await finish(hotel._id, "agent-list-hotel");
  await expect(leahToast, "Leah's other chat finishing toasts though her pane is open").toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shot("17-toast-other-chat") });
  await closePane();

  const alex = desk.chats.needs;
  const alexChats = () => convex<Summary[]>("comma/agent:chatsFor", { conversationId: alex });
  const owesAlex = async () => (await convex<{ flags: { unresponded: boolean } }>("comma/queries:getConversation", { conversationId: alex })).flags.unresponded;
  await row("Alex Rivera").click();
  await page.keyboard.press("Meta+e");
  await expect.poll(owesAlex, "the bridge settled Alex").toBe(false);
  await composer.click();
  await page.keyboard.press("Meta+j");
  const input = page.getByRole("textbox", { name: "Ask the agent" });
  await input.fill("what did Alex ask for?");
  await input.press("Enter");
  await expect(pane.getByTestId("agent-user-message")).toHaveText("what did Alex ask for?");
  // Shut before the turn ends, so the chat finishes unseen and comes back from Undo as ready.
  await closePane();
  await expect.poll(async () => (await alexChats()).map((chat) => chat.state)).toEqual(["idle"]);
  await lens(/^Needs you/).click();
  await expect(row("Alex Rivera"), "his agent chat alone brings Alex back to Needs you").toBeVisible();
  await expect(page.getByTestId("thread-view")).toContainText("Alex Rivera");
  const strip = page.getByTestId("state-strip");
  await expect(strip).toContainText("Agent chat open");
  await expect(strip, "no reply is owed").not.toContainText("Your turn");
  writeFileSync(join(evidence, "aria-strip-agent-only.txt"), await strip.ariaSnapshot());
  await page.screenshot({ path: shot("18-agent-only-strip") });
  const bridgeBefore = enqueued.length;
  await page.keyboard.press("Meta+e");
  await expect(row("Alex Rivera"), "⌘E takes Alex out of Needs you").toHaveCount(0);
  await expect.poll(async () => (await alexChats()).map((chat) => chat.settledAt !== undefined)).toEqual([true]);
  await page.screenshot({ path: shot("19-agent-only-settled"), clip: SIDEBAR });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row("Alex Rivera"), "Undo brings Alex back for his agent chat").toBeVisible();
  await expect.poll(async () => (await alexChats()).map((chat) => chat.settledAt)).toEqual([undefined]);
  expect(await owesAlex(), "Undo leaves the flag the user cleared cleared").toBe(false);
  const triage = () => enqueued.slice(bridgeBefore).filter((kind) => kind === "settle" || kind === "unsettle");
  expect(triage(), "no bridge settle or un-settle").toEqual([]);
  await page.waitForTimeout(1_000);
  await expect(page.getByText("Alex Rivera · agent finished"), "the chat Undo brought back is no arrival").toHaveCount(0);
  await row("Alex Rivera").click();
  await expect(strip).toContainText("Agent chat open");
  await page.screenshot({ path: shot("20-agent-only-undone") });
  effects.agentOnly = { chats: await alexChats(), owesReply: await owesAlex(), triageCommands: triage() };
  await closePane();

  await row("Alex Rivera").click();
  await closePane();
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("listbox", { name: "Results" });
  await expect(palette.getByText("Agent chats")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Command palette" }).locator("input"), "typing reaches the palette").toBeFocused();
  await page.screenshot({ path: shot("12-palette") });
  await page.keyboard.type("leah");
  await expect(palette.getByText("Rideshare codes"), "both of Leah's open chats").toBeVisible();
  await expect(palette.getByText("Hotel block for the crew")).toBeVisible();
  writeFileSync(join(evidence, "aria-palette-leah.txt"), await palette.ariaSnapshot());
  await page.screenshot({ path: shot("21-palette-leah") });
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("guest");
  await expect(palette.getByText("Reply about the guest list")).toBeVisible();
  await page.screenshot({ path: shot("13-palette-typed") });
  writeFileSync(join(evidence, "aria-palette.txt"), await palette.ariaSnapshot());
  await palette.getByText("Reply about the guest list").click();
  await expect(page.getByTestId("thread-view")).toContainText("Riley Chen");
  await expect(pane.getByTestId("pane-header")).toContainText("Reply about the guest list");
  await page.screenshot({ path: shot("14-palette-open") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await lens(/^Agents/).click();
  await expect.poll(() => listOrder(page)).toContain("# Failed");
  await expect(row("Riley Chen")).toContainText("Reply about the guest list");
  await page.screenshot({ path: shot("15-phone-agents") });
  writeFileSync(join(evidence, "side-effects.json"), JSON.stringify(effects, null, 2));
});
