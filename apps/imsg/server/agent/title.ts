/**
 * An agent chat's title from its first ask. The system prompt is T3 Code's
 * INITIAL_THREAD_TITLE_PROMPT (packages/provider-core/src/server/textGenerationPrompts.ts at
 * 05696c63, MIT License, Copyright (c) 2026 T3 Tools Inc.), adapted to a Comma agent chat: the
 * rules about code, PRs, branches and CI are gone and the person's name stays out.
 */
export const TITLE_PROMPT = `Generate a title that will help the user recognize this Comma agent chat weeks later.
Return JSON with keys title and needsRefinement.
Set needsRefinement to true only if the subject is still unknown, such as an unresolved link, "fix this", or an unexplained attachment. Otherwise set it to false.

Before answering, silently reduce the request to:
- Subject: What system, feature, or problem is this really about?
- Outcome: What does the user ultimately want to understand or change?
- Incidental instructions: What only describes how the agent should do the work?

Title the subject and outcome. Discard incidental instructions.

Editorial rules:
- 3-8 words, fewer than 40 characters.
- Use a compact noun phrase or clear action phrase.
- Capture the umbrella goal when the request lists several symptoms or steps.
- Models, subagents, tools, output formats, and monitoring instructions do not belong in the title unless they are themselves the topic.
- For research, name the question domain rather than the requested research process.
- Do not claim the work is complete.
- Do not copy and truncate the user's message.
- Avoid project names already visible in the UI, quotes, labels, filler, and trailing punctuation.
- When a URL or attachment is the only source of the subject, use available tools to inspect it directly.
- Leave out the name of the person the conversation is with; the app shows it beside the title.`;

export const TITLE_MODEL = "claude-haiku-5-5";
const TITLE_CHARS = 40;

export type TitleDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The gateway the Agent SDK reaches through ANTHROPIC_BASE_URL. */
  baseUrl: string;
  apiKey: string;
};

/**
 * The title, trimmed and clipped to 40 characters, or null when the reply carries none. A failed
 * request or an unreadable reply rejects with why, in words that name neither the key nor the ask.
 */
export async function chatTitle(firstAsk: string, deps: TitleDeps): Promise<string | null> {
  const response = await deps.fetch(`${deps.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": deps.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: TITLE_MODEL, max_tokens: 100, system: TITLE_PROMPT, messages: [{ role: "user", content: firstAsk.slice(0, 8_000) }] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let title: unknown;
  try {
    const { content } = await response.json() as { content?: { type: string; text?: string }[] };
    const text = (content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    ({ title } = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as { title?: unknown });
  } catch {
    // A parser's message quotes the reply, which can echo the ask.
    throw new Error("the reply was not a JSON title");
  }
  const trimmed = typeof title === "string" ? title.trim() : "";
  return trimmed ? trimmed.slice(0, TITLE_CHARS).trimEnd() : null;
}
