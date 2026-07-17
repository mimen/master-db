import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "./types";

/** Client-side mirror of the server's filter semantics (flags come precomputed). */
export function matchesFilters(chat: ChatSummary, state: StateFilter, type: TypeFilter): boolean {
  if (type === "dm" && (chat.isGroup || !chat.known)) return false;
  if (type === "group" && !chat.isGroup) return false;
  if (type === "unknown" && chat.known) return false;
  if (type !== "unknown" && state !== "all" && state !== "archived") {
    if (chat.isSpam || !chat.known) return false;
  }
  switch (state) {
    case "all":
      return !chat.flags.archived;
    case "unread":
      return chat.flags.unread && !chat.flags.archived;
    case "unresponded":
      return chat.flags.unresponded && !chat.flags.archived;
    case "waiting":
      return chat.flags.waiting && !chat.flags.archived;
    case "archived":
      return chat.flags.archived;
  }
}

export function computeCounts(chats: ChatSummary[], type: TypeFilter): StateCounts {
  const states: StateFilter[] = ["all", "unread", "unresponded", "waiting", "archived"];
  return Object.fromEntries(
    states.map((state) => [state, chats.filter((c) => matchesFilters(c, state, type)).length]),
  ) as StateCounts;
}
