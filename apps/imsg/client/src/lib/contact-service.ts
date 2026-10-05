import type { ChatSummary } from "@shared/types";
import { addressesMatch } from "@shared/address";
import { chatIsSMS } from "./chat-service";

export type Service = "iMessage" | "SMS";

/**
 * The service a handle is reached on, read from the existing one-to-one
 * conversation with it. An email can only be iMessage. Null when nothing
 * already known says which.
 */
export function contactService(address: string, chats: readonly ChatSummary[] | null): Service | null {
  const dm = chats?.find((chat) => !chat.isGroup && chat.participants.some((p) => addressesMatch(p.address, address)));
  if (dm) return chatIsSMS(dm.guid) ? "SMS" : "iMessage";
  return address.includes("@") ? "iMessage" : null;
}

/** Splits `name` around a case-insensitive prefix match so the typed part can be bolded. */
export function splitPrefix(name: string, query: string): { match: string; rest: string } {
  const q = query.trim();
  if (q && name.toLowerCase().startsWith(q.toLowerCase())) return { match: name.slice(0, q.length), rest: name.slice(q.length) };
  return { match: "", rest: name };
}
