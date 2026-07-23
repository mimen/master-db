import type { ChatSummary, Contact, Message } from "@shared/types";

/**
 * Headless ⌘K palette engine — pure derivation, no React, no platform code.
 * The desktop overlay renders these sections today; a future mobile sheet
 * reuses this file untouched. Matching is deliberately substring + prefix
 * boost (the sidebar's semantics), not fuzzy: predictable beats clever.
 */

export type PaletteCommandId =
  | { kind: "state"; value: "all" | "unread" | "unresponded" | "waiting" | "archived" }
  | { kind: "type"; value: "dm" | "group" | "unknown" }
  | { kind: "tab"; value: "messages" | "contacts" }
  | { kind: "action"; value: "new-message" | "shortcuts" };

export interface PaletteCommand {
  id: PaletteCommandId;
  title: string;
  /** Extra match terms beyond the title (e.g. "filter", "view"). */
  keywords: readonly string[];
  /** Section subtitle rendered beside the title. */
  hint: string;
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  { id: { kind: "state", value: "all" }, title: "All Conversations", keywords: ["view", "filter", "inbox"], hint: "View" },
  { id: { kind: "state", value: "unread" }, title: "Unread", keywords: ["view", "filter"], hint: "View" },
  { id: { kind: "state", value: "unresponded" }, title: "Unresponded", keywords: ["view", "filter", "needs reply"], hint: "View" },
  { id: { kind: "state", value: "waiting" }, title: "Waiting", keywords: ["view", "filter", "awaiting reply"], hint: "View" },
  { id: { kind: "state", value: "archived" }, title: "Archived", keywords: ["view", "filter"], hint: "View" },
  { id: { kind: "type", value: "dm" }, title: "DMs", keywords: ["view", "filter", "direct messages"], hint: "View" },
  { id: { kind: "type", value: "group" }, title: "Groups", keywords: ["view", "filter", "group chats"], hint: "View" },
  { id: { kind: "type", value: "unknown" }, title: "Unknown Senders", keywords: ["view", "filter", "spam", "numbers"], hint: "View" },
  { id: { kind: "tab", value: "messages" }, title: "Go to Messages", keywords: ["tab", "inbox"], hint: "Navigate" },
  { id: { kind: "tab", value: "contacts" }, title: "Go to Contacts", keywords: ["tab", "people"], hint: "Navigate" },
  { id: { kind: "action", value: "new-message" }, title: "New Message", keywords: ["compose", "start", "chat"], hint: "Action" },
  { id: { kind: "action", value: "shortcuts" }, title: "Keyboard Shortcuts", keywords: ["help", "keys"], hint: "Action" },
] as const;

export type PaletteItem =
  | { kind: "command"; key: string; command: PaletteCommand }
  | { kind: "conversation"; key: string; chat: ChatSummary }
  | { kind: "group"; key: string; chat: ChatSummary; matchedMember: string | null }
  | { kind: "message"; key: string; message: Message }
  | { kind: "contact"; key: string; contact: Contact };

export interface PaletteSection {
  title: string;
  items: PaletteItem[];
}

/** 3 = exact, 2 = a word starts with the needle, 1 = substring, 0 = miss. */
export function matchScore(needle: string, haystack: string): number {
  const hay = haystack.toLowerCase();
  if (hay === needle) return 3;
  const at = hay.indexOf(needle);
  if (at === -1) return 0;
  if (at === 0 || hay[at - 1] === " ") return 2;
  return 1;
}

function bestParticipantMatch(needle: string, chat: ChatSummary): { score: number; name: string | null } {
  let score = 0;
  let name: string | null = null;
  for (const p of chat.participants) {
    const label = p.name ?? p.address;
    const s = Math.max(matchScore(needle, label), matchScore(needle, p.address));
    if (s > score) {
      score = s;
      name = label;
    }
  }
  return { score, name };
}

const CAPS = { commands: 6, conversations: 5, groups: 5, messages: 8, contacts: 6 } as const;

function commandKey(id: PaletteCommandId): string {
  return `cmd-${id.kind}-${id.value}`;
}

export interface PaletteInput {
  query: string;
  /** Recency-ordered universe (archived included) — search spans everything. */
  chats: readonly ChatSummary[];
  /** Server message hits for the CURRENT query (already filtered); [] while pending. */
  messages: readonly Message[];
  /** Contact-directory hits for the CURRENT query; [] while pending. */
  contacts: readonly Contact[];
}

/** Section order is the approved ranking: Commands (only when matched) →
 * DM conversations → Groups → Message hits → Contact records. Blank query
 * shows every command plus recent conversations. */
export function buildPaletteSections(input: PaletteInput): PaletteSection[] {
  const needle = input.query.trim().toLowerCase();
  const sections: PaletteSection[] = [];

  if (needle.length === 0) {
    sections.push({
      title: "Commands",
      items: PALETTE_COMMANDS.map((command) => ({
        kind: "command",
        key: commandKey(command.id),
        command,
      })),
    });
    const recents = input.chats
      .filter((chat) => !chat.flags.archived)
      .slice(0, 6)
      .map((chat): PaletteItem => ({ kind: "conversation", key: `chat-${chat.guid}`, chat }));
    if (recents.length > 0) sections.push({ title: "Recent", items: recents });
    return sections;
  }

  const scored = <T>(entries: Array<{ score: number; item: T }>, cap: number): T[] =>
    entries
      .filter((e) => e.score > 0)
      // Stable sort: equal scores keep the input (recency) order.
      .sort((a, b) => b.score - a.score)
      .slice(0, cap)
      .map((e) => e.item);

  const commands = scored(
    PALETTE_COMMANDS.map((command) => ({
      score: Math.max(
        matchScore(needle, command.title),
        ...command.keywords.map((k) => matchScore(needle, k)),
      ),
      item: { kind: "command", key: commandKey(command.id), command } satisfies PaletteItem,
    })),
    CAPS.commands,
  );

  const conversations = scored(
    input.chats
      .filter((chat) => !chat.isGroup)
      .map((chat) => ({
        score: Math.max(matchScore(needle, chat.displayName), bestParticipantMatch(needle, chat).score),
        item: { kind: "conversation", key: `chat-${chat.guid}`, chat } satisfies PaletteItem,
      })),
    CAPS.conversations,
  );

  const groups = scored(
    input.chats
      .filter((chat) => chat.isGroup)
      .map((chat) => {
        const nameScore = matchScore(needle, chat.displayName);
        const member = bestParticipantMatch(needle, chat);
        return {
          // A group NAME hit outranks a member hit at equal match quality.
          score: Math.max(nameScore * 2, member.score),
          item: {
            kind: "group",
            key: `group-${chat.guid}`,
            chat,
            matchedMember: member.score > nameScore ? member.name : null,
          } satisfies PaletteItem,
        };
      }),
    CAPS.groups,
  );

  if (commands.length > 0) sections.push({ title: "Commands", items: commands });
  if (conversations.length > 0) sections.push({ title: "Conversations", items: conversations });
  if (groups.length > 0) sections.push({ title: "Groups", items: groups });
  if (input.messages.length > 0) {
    sections.push({
      title: "Messages",
      items: input.messages.slice(0, CAPS.messages).map((message) => ({
        kind: "message",
        key: `msg-${message.guid}`,
        message,
      })),
    });
  }
  if (input.contacts.length > 0) {
    sections.push({
      title: "Contacts",
      items: input.contacts.slice(0, CAPS.contacts).map((contact) => ({
        kind: "contact",
        key: `contact-${contact.address}-${contact.name}`,
        contact,
      })),
    });
  }
  return sections;
}

/** Row-major flattening for roving keyboard selection. */
export function flattenSections(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items);
}
