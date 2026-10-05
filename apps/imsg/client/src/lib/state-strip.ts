import { settleActionFor } from "@shared/chat-state";
import type { ChatSummary, Message } from "@shared/types";
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
import { format } from "date-fns/format";

import { compactAge } from "@/lib/turn-age";

export type StripTone = "turn" | "waiting" | "settled";

/** What the state strip above the composer says about the open conversation. */
export interface StripCopy {
  readonly tone: StripTone;
  readonly lead: string;
  readonly detail: string | null;
  readonly action: "settle" | "unsettle" | null;
}

type StripMessage = Pick<Message, "isFromMe" | "isGroupEvent" | "dateCreated">;

export interface StripInput {
  readonly chat: ChatSummary;
  /** The thread's loaded messages, oldest first. */
  readonly messages: readonly StripMessage[];
  /** True when the loaded window reaches the start of the conversation. */
  readonly historyComplete: boolean;
  readonly now: number;
  /** Phone width: "Replied Friday" instead of "You last replied Friday". */
  readonly compact: boolean;
}

/** "today", "yesterday", a weekday inside the last week, else "Mar 3". */
export function relativeDay(at: number, now: number): string {
  const days = differenceInCalendarDays(now, at);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return format(at, "EEEE");
  return format(at, "MMM d");
}

/** Who "texts again": a DM's first name, a phone number whole, a group as "someone". */
export function firstName(chat: Pick<ChatSummary, "displayName" | "isGroup">): string {
  if (chat.isGroup) return "someone";
  const first = chat.displayName.trim().split(/\s+/)[0] ?? "";
  return /[a-z]/i.test(first) ? first : chat.displayName;
}

function lastIndex(messages: readonly StripMessage[], fromMe: boolean): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (!message.isGroupEvent && message.isFromMe === fromMe) return i;
  }
  return -1;
}

export function stripCopy({ chat, messages, historyComplete, now, compact }: StripInput): StripCopy | null {
  const action = settleActionFor(chat);
  if (action === "none") return null;
  if (action === "unsettle") {
    return { tone: "settled", lead: "Settled", detail: `Back in Needs reply if ${firstName(chat)} texts again`, action };
  }
  const last = chat.lastMessage;
  if (chat.flags.waiting && last) {
    return { tone: "waiting", lead: `Waiting on ${firstName(chat)} ${compactAge(now - last.dateCreated)}`, detail: null, action };
  }

  // Your turn began with the first inbound message after your newest reply.
  const reply = lastIndex(messages, true);
  const turnStart = messages.slice(reply + 1).find((m) => !m.isGroupEvent && !m.isFromMe);
  const since = turnStart?.dateCreated ?? chat.firstUnreadAt ?? last?.dateCreated ?? now;
  const replied = reply >= 0
    ? `${compact ? "Replied" : "You last replied"} ${relativeDay(messages[reply]!.dateCreated, now)}`
    : historyComplete && messages.length > 0
      ? "You haven't replied yet"
      : null;
  return { tone: "turn", lead: `Your turn for ${compactAge(now - since)}`, detail: replied, action };
}
