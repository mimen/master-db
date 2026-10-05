import type { ChatSummary } from "@shared/types";
import type { PaletteItem, PaletteSection } from "@/lib/palette/model";
import { compactAge, LATE_AFTER_MS, yourTurnLongest } from "@/lib/turn-age";

export interface RowAge {
  text: string;
  /** Past LATE_AFTER_MS on a your-turn age: drawn in the turn color. */
  late: boolean;
}

/** "Your turn 2w" for a conversation waiting on the owner, else null. */
export function turnAge(chat: ChatSummary, now: number): RowAge | null {
  const aged = yourTurnLongest([chat], 1, now)[0];
  return aged ? { text: `Your turn ${compactAge(aged.ageMs)}`, late: aged.ageMs > LATE_AFTER_MS } : null;
}

/** Compact time since the newest message, e.g. "5h". */
export function recencyAge(chat: ChatSummary, now: number): RowAge | null {
  const at = chat.lastMessage?.dateCreated;
  return at === undefined ? null : { text: compactAge(Math.max(0, now - at)), late: false };
}

export interface PeopleFirst {
  sections: PaletteSection[];
  ages: ReadonlyMap<string, RowAge>;
}

const conversation = (chat: ChatSummary): PaletteItem => ({ kind: "conversation", key: `chat-${chat.guid}`, chat });

/**
 * The empty-query palette: the four conversations that have been the owner's turn longest, then
 * the next three by recency that are not already listed. Commands wait until the owner types.
 */
export function peopleFirstSections(chats: readonly ChatSummary[], now: number): PeopleFirst {
  const ages = new Map<string, RowAge>();
  const longest = yourTurnLongest(chats, 4, now);
  const listed = new Set(longest.map(({ chat }) => chat.guid));
  const recent = chats.filter((chat) => !listed.has(chat.guid)).slice(0, 3);
  for (const { chat } of longest) {
    const age = turnAge(chat, now);
    if (age) ages.set(`chat-${chat.guid}`, age);
  }
  for (const chat of recent) {
    const age = recencyAge(chat, now);
    if (age) ages.set(`chat-${chat.guid}`, age);
  }
  const sections: PaletteSection[] = [];
  if (longest.length > 0) sections.push({ title: "Your turn the longest", items: longest.map(({ chat }) => conversation(chat)) });
  if (recent.length > 0) sections.push({ title: "Recent", items: recent.map(conversation) });
  return { sections, ages };
}

/** A query led by ">" asks for commands only; returns the filter text after it, else null. */
export function commandQuery(query: string): string | null {
  const trimmed = query.trimStart();
  return trimmed.startsWith(">") ? trimmed.slice(1) : null;
}
