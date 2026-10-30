import type { OptimisticLocalStore, OptimisticUpdate } from "convex/browser";
import { optimisticallyUpdateValueInPaginatedQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { GenericId } from "convex/values";
import { agentApi } from "./agent-api";
import { commaApi, todayApi, triageApi } from "./convex-api";
import { conversationIdVia, watchCommandVia, type ResultCommandClient } from "./convex-commands";

/**
 * Comma's own conversation state (settles, pins, reads, marked-unread) lives in Convex. Each write here carries an
 * optimistic update, so the listed rows, Today's clear log and the agent list change in the frame of the gesture.
 * Convex keeps the update until its own query results include the write, or drops it when the write fails.
 */

type Row = FunctionReturnType<typeof commaApi.listConversations>["page"][number];
type ConversationId = GenericId<"comma_conversations">;
type Mutation = FunctionReference<"mutation">;

export interface ConversationStateClient extends Pick<ResultCommandClient, "query" | "watchQuery"> {
  mutation<Ref extends Mutation>(ref: Ref, args: FunctionArgs<Ref>, options?: { optimisticUpdate?: OptimisticUpdate<FunctionArgs<Ref>> }): Promise<FunctionReturnType<Ref>>;
}

/** What each write does to a listed conversation, the way Convex will derive it. */
export const rowAfter = {
  settle: (row: Row, anchor: string | undefined): Row => !row.lastMessage || (anchor !== undefined && anchor !== row.lastMessage.guid)
    ? row : { ...row, flags: { ...row.flags, unresponded: false, waiting: false } },
  unsettle: (row: Row): Row => !row.lastMessage
    ? row : { ...row, flags: { ...row.flags, unresponded: !row.lastMessage.isFromMe, waiting: row.lastMessage.isFromMe } },
  pin: (row: Row, pinned: boolean): Row => ({ ...row, flags: { ...row.flags, pinned } }),
  markUnread: (row: Row): Row => ({ ...row, flags: { ...row.flags, unread: true } }),
  read: (row: Row, at: number): Row => {
    const unreadCount = at >= row.lastMessageAt ? 0 : row.unreadCount;
    return { ...row, unreadCount, flags: { ...row.flags, unread: unreadCount > 0 } };
  },
};

function patchRow(store: OptimisticLocalStore, conversationId: ConversationId, update: (row: Row) => Row): void {
  optimisticallyUpdateValueInPaginatedQuery(store, commaApi.listConversations, {}, (row) => (row._id === conversationId ? update(row) : row));
}

/** Today reads its done gaps and Settled today off the clear log. A null `at` takes the conversation's clear back. */
function patchCleared(store: OptimisticLocalStore, conversationId: ConversationId, at: number | null): void {
  for (const { args, value } of store.getAllQueries(todayApi.get)) {
    if (!value) continue;
    const cleared = value.cleared.filter((row) => row.conversationId !== conversationId);
    store.setQuery(todayApi.get, args, { ...value, cleared: at === null ? cleared : [...cleared, { conversationId, at }] });
  }
}

/** A settle closes the conversation's open agent chats, so its row stops being in Needs you for them. */
function dropAgentChats(store: OptimisticLocalStore, conversationId: ConversationId): void {
  const open = store.getQuery(agentApi.listAgentChats, {});
  if (open) store.setQuery(agentApi.listAgentChats, {}, open.filter((chat) => chat.conversationId !== conversationId));
}

export const optimistic = {
  settle: ((store, { conversationId, anchor }) => {
    patchRow(store, conversationId, (row) => rowAfter.settle(row, anchor));
    patchCleared(store, conversationId, Date.now());
    dropAgentChats(store, conversationId);
  }) satisfies OptimisticUpdate<FunctionArgs<typeof triageApi.settle>>,
  unsettle: ((store, { conversationId }) => {
    patchRow(store, conversationId, rowAfter.unsettle);
    patchCleared(store, conversationId, null);
  }) satisfies OptimisticUpdate<FunctionArgs<typeof triageApi.unsettle>>,
  settleAgents: ((store, { conversationId }) => dropAgentChats(store, conversationId)) satisfies OptimisticUpdate<FunctionArgs<typeof agentApi.settleConversationAgents>>,
  pin: ((store, { conversationId, pinned }) => patchRow(store, conversationId, (row) => rowAfter.pin(row, pinned))) satisfies OptimisticUpdate<FunctionArgs<typeof triageApi.setPinned>>,
  markUnread: ((store, { conversationId }) => patchRow(store, conversationId, rowAfter.markUnread)) satisfies OptimisticUpdate<FunctionArgs<typeof triageApi.markUnread>>,
  read: ((store, { conversationId, at }) => patchRow(store, conversationId, (row) => rowAfter.read(row, at))) satisfies OptimisticUpdate<FunctionArgs<typeof triageApi.markRead>>,
};

/** A conversation as a caller knows it: a listed row carries its id, a bare chat guid is looked up. */
type ChatRef = { guid: string; conversationId?: string };

/** Writes against one conversation. */
export function conversationStateVia(client: ConversationStateClient) {
  const id = async (chat: ChatRef) => (chat.conversationId as ConversationId | undefined) ?? await conversationIdVia(client, chat.guid);
  return {
    async settle(chat: ChatRef, anchor: string | undefined): Promise<void> {
      const conversationId = await id(chat);
      await client.mutation(triageApi.settle, { conversationId, ...(anchor !== undefined ? { anchor } : {}) }, { optimisticUpdate: optimistic.settle });
    },
    async unsettle(chat: ChatRef): Promise<void> {
      await client.mutation(triageApi.unsettle, { conversationId: await id(chat) }, { optimisticUpdate: optimistic.unsettle });
    },
    async settleAgents(chat: ChatRef): Promise<void> {
      await client.mutation(agentApi.settleConversationAgents, { conversationId: await id(chat) }, { optimisticUpdate: optimistic.settleAgents });
    },
    async reopenAgents(chat: ChatRef): Promise<void> {
      await client.mutation(agentApi.reopenConversationAgents, { conversationId: await id(chat) });
    },
    async pin(chat: ChatRef, pinned: boolean): Promise<void> {
      await client.mutation(triageApi.setPinned, { conversationId: await id(chat), pinned }, { optimisticUpdate: optimistic.pin });
    },
    async markUnread(chat: ChatRef): Promise<void> {
      await client.mutation(triageApi.markUnread, { conversationId: await id(chat) }, { optimisticUpdate: optimistic.markUnread });
    },
    /** Reads in Convex at once; resolves when the Mini has sent iMessage's read receipt, and rejects if it could not. */
    async read(chat: ChatRef): Promise<void> {
      const conversationId = await id(chat);
      const receipt = await client.mutation(triageApi.markRead, { conversationId, at: Date.now() }, { optimisticUpdate: optimistic.read });
      await watchCommandVia(client, receipt, "markRead");
    },
  };
}

/** The shared authenticated client, imported on first use like the command queue's. */
export async function conversationState(): Promise<ReturnType<typeof conversationStateVia>> {
  const { convexClient } = await import("./identity");
  return conversationStateVia(convexClient);
}
