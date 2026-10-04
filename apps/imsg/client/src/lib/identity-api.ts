import { makeFunctionReference } from "convex/server";
import type { Contact } from "@shared/types";

export const identityApi = {
  searchContacts: makeFunctionReference<"query", { q: string; limit?: number }, Contact[]>("identity/queries:searchContacts"),
  findChat: makeFunctionReference<"query", { address: string; service?: "iMessage" | "SMS" },
    null | { chatGuid: string; service: "iMessage" | "SMS"; isGroup: false; participants: string[] }>("comma/conversationInfo:findChat"),
  chatInfo: makeFunctionReference<"query", { chatGuid: string },
    null | { guid: string; displayName: string | null; isGroup: boolean; participants: Contact[] }>("comma/conversationInfo:chatInfo"),
};

export function contactSearchArgs(q: string) {
  return { q };
}
