import type { api } from "@convex-api";
import { anyApi } from "convex/server";

const queries = anyApi.comma.queries as unknown as typeof api.comma.queries;
export const commaDraftsApi = anyApi.comma.drafts as unknown as typeof api.comma.drafts;
export const commaOutbox = anyApi.comma.outbox as unknown as typeof api.comma.outbox;
const today = anyApi.comma.today as unknown as typeof api.comma.today;
export const todayApi = { get: today.get, requestBuild: today.requestBuild };
export const pendingSendsApi = anyApi.comma.pendingSends as unknown as typeof api.comma.pendingSends;
export const triageApi = anyApi.comma.triage as unknown as typeof api.comma.triage;
export const accountsApi = anyApi.comma.accounts as unknown as typeof api.comma.accounts;
export const scheduledSendsApi = anyApi.comma.scheduledSends as unknown as typeof api.comma.scheduledSends;

/** Include public foundation functions whose module differs from comma/queries. */
export const commaApi = {
  listConversations: queries.listConversations,
  listEmailThreads: queries.listEmailThreads,
  getConversation: queries.getConversation,
  listMessages: queries.listMessages,
  searchMessages: queries.searchMessages,
  resolveChat: queries.resolveChat,
  listScheduled: queries.listScheduled,
  getDraft: queries.getDraft,
  listDrafts: queries.listDrafts,
  syncStatus: queries.syncStatus,
  getSuggestions: queries.getSuggestions,
  getCommand: commaOutbox.getCommand,
  enqueue: commaOutbox.enqueue,
  outboxStatusFor: commaOutbox.outboxStatusFor,
};
