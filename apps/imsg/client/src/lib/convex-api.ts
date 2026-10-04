import type { api } from "@convex-api";
import { anyApi } from "convex/server";

const queries = anyApi.comma.queries as unknown as typeof api.comma.queries;
export const commaDraftsApi = anyApi.comma.drafts as unknown as typeof api.comma.drafts;
export const commaOutbox = anyApi.comma.outbox as unknown as typeof api.comma.outbox;

/** Include public foundation functions whose module differs from comma/queries. */
export const commaApi = {
  listConversations: queries.listConversations,
  getConversation: queries.getConversation,
  listMessages: queries.listMessages,
  searchMessages: queries.searchMessages,
  resolveChat: queries.resolveChat,
  listScheduled: queries.listScheduled,
  getDraft: queries.getDraft,
  syncStatus: queries.syncStatus,
  getSuggestions: queries.getSuggestions,
  getCommand: commaOutbox.getCommand,
  enqueue: commaOutbox.enqueue,
  outboxStatusFor: commaOutbox.outboxStatusFor,
};
