import { defineTable } from "convex/server";

import {
  attachmentFields,
  chatAliasFields,
  conversationFields,
  conversationStateFields,
  draftFields,
  messageFields,
  outboxFields,
  scheduledFields,
  suggestionFields,
  syncStateFields,
  triageEventFields,
  triageOpenFields,
} from "./validators";

export const comma_conversations = defineTable(conversationFields)
  .index("by_conversationKey", ["conversationKey"])
  .index("by_lastMessageAt", ["lastMessageAt"])
  .index("by_primaryChatGuid", ["primaryChatGuid"]);

export const comma_chat_aliases = defineTable(chatAliasFields)
  .index("by_chatGuid", ["chatGuid"])
  .index("by_conversationId", ["conversationId"]);

export const comma_messages = defineTable(messageFields)
  .index("by_guid", ["guid"])
  .index("by_conversation_date", ["conversationId", "dateCreated"])
  .index("by_clientKey", ["clientKey"])
  .index("by_tapbackTargetGuid", ["tapbackTargetGuid"])
  .searchIndex("search_text", {
    searchField: "text",
    filterFields: ["conversationId", "isTapback", "retracted"],
  });

export const comma_attachments = defineTable(attachmentFields)
  .index("by_guid", ["guid"])
  .index("by_messageGuid", ["messageGuid"])
  .index("by_conversationId", ["conversationId"]);

export const comma_conversation_state = defineTable(conversationStateFields).index("by_conversationId", [
  "conversationId",
]);

export const comma_triage_events = defineTable(triageEventFields)
  .index("by_clearedAt", ["clearedAt"])
  .index("by_conversationId", ["conversationId"]);

export const comma_triage_open = defineTable(triageOpenFields).index("by_conversationId", ["conversationId"]);

export const comma_outbox = defineTable(outboxFields)
  .index("by_clientKey", ["clientKey"])
  .index("by_status_createdAt", ["status", "createdAt"]);

export const comma_drafts = defineTable(draftFields).index("by_conversationId", ["conversationId"]);

export const comma_scheduled = defineTable(scheduledFields)
  .index("by_bbId", ["bbId"])
  .index("by_sendAt", ["sendAt"]);

export const comma_suggestions = defineTable(suggestionFields).index("by_conversationId", ["conversationId"]);

export const comma_sync_state = defineTable(syncStateFields).index("by_key", ["key"]);
