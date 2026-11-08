import type { Infer } from "convex/values";

import type { ModelText, ToModelText } from "../../apps/imsg/shared/model-text";
import type { mention } from "../schema/comma/validators";

type Mention = Infer<typeof mention>;

/**
 * Slack's message text as people and models read it. Slack sends mrkdwn with control sequences in angle brackets
 * (`<@U1>`, `<#C1|general>`, `<https://x|label>`, `<!here>`) and escapes `&`, `<` and `>` as entities.
 */

/** A Slack user id's display name, when Comma knows it. */
export type SlackNames = (userId: string) => string | undefined;

export interface SlackRawMessage {
  text: string;
  ts: string;
  thread_ts?: string;
}

const CONTROL = /<([^<>]+)>/g;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt);/g, (entity) => ENTITIES[entity]!);
}

/** One control sequence as text: a mention, a channel, a special mention, or a link (with its URL for a model). */
function control(body: string, names: SlackNames, withUrls: boolean): { text: string; userId?: string } {
  const [target = "", label] = body.split("|", 2);
  if (target.startsWith("@")) {
    const userId = target.slice(1);
    return { text: `@${names(userId) ?? label ?? "Slack user"}`, userId };
  }
  if (target.startsWith("#")) return { text: `#${label ?? "channel"}` };
  if (target.startsWith("!subteam^")) return { text: label ?? "@team" };
  if (target.startsWith("!date^")) return { text: label ?? "a date" };
  if (target.startsWith("!")) return { text: `@${target.slice(1)}` };
  const url = decode(target).replace(/^mailto:/, "");
  if (!label || decode(label) === url) return { text: url };
  return { text: withUrls ? `${decode(label)} (${url})` : decode(label) };
}

function render(raw: string, names: SlackNames, withUrls: boolean): { text: string; mentions: Mention[] } {
  let text = "";
  const mentions: Mention[] = [];
  let at = 0;
  for (const match of raw.matchAll(CONTROL)) {
    text += decode(raw.slice(at, match.index));
    const part = control(match[1]!, names, withUrls);
    if (part.userId) mentions.push({ address: `slack:${part.userId}`, start: text.length, length: part.text.length });
    text += part.text;
    at = match.index + match[0].length;
  }
  return { text: text + decode(raw.slice(at)), mentions };
}

/** What a bubble and a preview show: names for mentions, labels for links, entities decoded, and where each mention sits. */
export function slackDisplayText(raw: string, names: SlackNames): { text: string; mentions: Mention[] } {
  return render(raw, names, false);
}

/** Slack's ToModelText: links keep their URL beside the label, and a thread reply names its root. */
export function slackModelText(names: SlackNames): ToModelText<SlackRawMessage> {
  return (message): ModelText => {
    const display = render(message.text, names, false).text;
    const model = render(message.text, names, true).text;
    return {
      ...(model !== display ? { modelText: model } : {}),
      ...(message.thread_ts && message.thread_ts !== message.ts ? { threadRef: message.thread_ts } : {}),
    };
  };
}
