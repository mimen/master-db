import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  accountFields,
  agentBridgeStateFields,
  agentChatFields,
  agentCommandFields,
  agentItemFields,
  attachmentFields,
  presenceFields,
  bridgeStateFields,
  uploadFields,
  chatAliasFields,
  conversationFields,
  conversationStateFields,
  draftFields,
  messageRowFields,
  outboxFields,
  reactionFields,
  scheduledFields,
  suggestionFields,
  syncStateFields,
  todayQueueFields,
  triageEventFields,
  triageOpenFields,
} from "./validators";

export const comma_accounts = defineTable(accountFields).index("by_platform_externalId", ["platform", "externalId"]);

export const comma_conversations = defineTable(conversationFields)
  .index("by_platform_account_key", ["platform", "accountId", "conversationKey"])
  /** Finds rows written before accounts; drop after the accounts backfill. */
  .index("by_platform_conversationKey", ["platform", "conversationKey"])
  .index("by_lastMessageAt", ["lastMessageAt"])
  .index("by_primaryChatGuid", ["primaryChatGuid"])
  .index("by_unreadCount", ["unread.count"]);

export const comma_chat_aliases = defineTable(chatAliasFields)
  .index("by_chatGuid", ["chatGuid"])
  .index("by_conversationId", ["conversationId"]);

export const comma_messages = defineTable(messageRowFields)
  .index("by_platform_account_guid", ["platform", "accountId", "guid"])
  /** Finds rows written before accounts; drop after the accounts backfill. */
  .index("by_guid", ["guid"])
  .index("by_conversation_date", ["conversationId", "dateCreated"])
  .index("by_sender_conversation_date", ["sender.address", "conversationId", "dateCreated"])
  .index("by_clientKey", ["clientKey"])
  /** An account's sent messages, newest last, for the reply voice. */
  .index("by_platform_account_fromMe_date", ["platform", "accountId", "isFromMe", "dateCreated"])
  .searchIndex("search_text", {
    searchField: "text",
    filterFields: ["conversationId", "isTapback", "retracted", "isFromMe"],
  });

export const comma_reactions = defineTable(reactionFields)
  .index("by_targetKey", ["targetKey"])
  .index("by_conversationId", ["conversationId"]);

export const comma_attachments = defineTable(attachmentFields)
  .index("by_guid", ["guid"])
  .index("by_messageGuid", ["messageGuid"])
  .index("by_conversationId", ["conversationId"]);

export const comma_conversation_state = defineTable(conversationStateFields).index("by_conversationId", [
  "conversationId",
]);

export const comma_triage_events = defineTable(triageEventFields)
  .index("by_clearedAt", ["clearedAt"])
  .index("by_conversationId", ["conversationId"])
  .index("by_conversation_message", ["conversationId", "messageGuid"]);

/** Retired: the Mini's open-item mirror. Nothing reads or writes it; its rows stay for the record. */
export const comma_triage_open = defineTable(triageOpenFields).index("by_conversationId", ["conversationId"]);

export const comma_outbox = defineTable(outboxFields)
  .index("by_clientKey", ["clientKey"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_lane_status_createdAt", ["lane", "status", "createdAt"])
  .index("by_resultGuid", ["resultGuid"]);

export const comma_drafts = defineTable(draftFields).index("by_conversationId", ["conversationId"]).index("by_updatedAt", ["updatedAt"]);

export const comma_scheduled = defineTable(scheduledFields)
  .index("by_bbId", ["bbId"])
  .index("by_sendAt", ["sendAt"]);

export const comma_suggestions = defineTable(suggestionFields)
  .index("by_conversationId", ["conversationId"])
  .index("by_conversation_model", ["conversationId", "model"]);

export const comma_sync_state = defineTable(syncStateFields).index("by_key", ["key"]).index("by_account_key", ["accountId", "key"]);

export const comma_presence = defineTable(presenceFields).index("by_conversationId", ["conversationId"]);
export const comma_bridge_state = defineTable(v.union(v.object(bridgeStateFields), v.object(agentBridgeStateFields)))
  .index("by_key", ["key"]);
export const comma_uploads = defineTable(uploadFields).index("by_storageId", ["storageId"]).index("by_commandId", ["commandId"]);

export const comma_agent_chats = defineTable(agentChatFields)
  .index("by_conversationId", ["conversationId"])
  .index("by_settledAt", ["settledAt"]);
export const comma_agent_items = defineTable(agentItemFields)
  .index("by_chat_ordinal", ["chatId", "ordinal"])
  .index("by_chat_key", ["chatId", "key"])
  .index("by_key", ["key"]);
export const comma_agent_commands = defineTable(agentCommandFields).index("by_status_createdAt", ["status", "createdAt"]);

export const comma_today_queue = defineTable(todayQueueFields).index("by_day", ["day"]);
