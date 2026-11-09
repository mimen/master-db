import type { OptimisticLocalStore, OptimisticUpdate } from "convex/browser";
import { optimisticallyUpdateValueInPaginatedQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { attentionOf } from "@shared/platform-profile";
import type { ConversationId } from "@shared/types";
import { agentApi } from "./agent-api";
import { commaApi, laterApi, todayApi, triageApi } from "./convex-api";
import { watchCommandVia, type ResultCommandClient } from "./convex-commands";

/**
 * Comma's own conversation state (settles, pins, reads, marked-unread) lives in Convex. Each write here carries an
 * optimistic update, so the listed rows, Today's clear log and the agent list change in the frame of the gesture.
 * Convex keeps the update until its own query results include the write, or drops it when the write fails.
 */

type Row = FunctionReturnType<typeof commaApi.listConversations>["page"][number];
type Mutation = FunctionReference<"mutation">;

export interface ConversationStateClient extends Pick<ResultCommandClient, "watchQuery"> {
  mutation<Ref extends Mutation>(ref: Ref, args: FunctionArgs<Ref>, options?: { optimisticUpdate?: OptimisticUpdate<FunctionArgs<Ref>> }): Promise<FunctionReturnType<Ref>>;
}

/** What each write does to a listed conversation, the way Convex will derive it. */
export const rowAfter = {
  settle: (row: Row, anchor: string | undefined): Row => !row.lastMessage || (anchor !== undefined && anchor !== row.lastMessage.guid)
    ? row : { ...row, flags: { ...row.flags, unresponded: false, waiting: false } },
  unsettle: (row: Row): Row => {
    if (!row.lastMessage) return row;
    const attention = attentionOf({ ...row, platform: row.platform ?? "imessage" }, row.lastMessage);
    return { ...row, flags: { ...row.flags, unresponded: attention === "needsYou", waiting: attention === "waiting" } };
  },
  pin: (row: Row, pinned: boolean): Row => ({ ...row, flags: { ...row.flags, pinned } }),
  markUnread: (row: Row): Row => ({ ...row, flags: { ...row.flags, unread: true } }),
  snooze: (row: Row, until: number): Row => ({
    ...row, unreadCount: 0, flags: { ...row.flags, unresponded: false, waiting: false, unread: false },
    later: { ...(row.later?.followUp ? { followUp: row.later.followUp } : {}), snoozedUntil: until },
  }),
  read: (row: Row, at: number): Row => {
    const unreadCount = at >= row.lastMessageAt ? 0 : row.unreadCount;
    return { ...row, unreadCount, flags: { ...row.flags, unread: unreadCount > 0 } };
  },
};

/** Messages lists conversations, Mail and Today's mail rows list email threads; one id is in one of them. */
function patchRow(store: OptimisticLocalStore, conversationId: ConversationId, update: (row: Row) => Row): void {
  for (const list of [commaApi.listConversations, commaApi.listEmailThreads]) {
    optimisticallyUpdateValueInPaginatedQuery(store, list, {}, (row) => (row._id === conversationId ? update(row) : row));
  }
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
  snooze: ((store, { conversationId, until }) => patchRow(store, conversationId, (row) => rowAfter.snooze(row, until))) satisfies OptimisticUpdate<FunctionArgs<typeof laterApi.snooze>>,
  read: ((store, { conversationId, at }) => patchRow(store, conversationId, (row) => rowAfter.read(row, at))) satisfies OptimisticUpdate<FunctionArgs<typeof triageApi.markRead>>,
};

/** Writes against one conversation. */
export function conversationStateVia(client: ConversationStateClient) {
  return {
    /** An email thread's settle also archives it in Gmail: `archived` rejects when Gmail refused, which un-settled it again. */
    async settle(conversationId: ConversationId, anchor: string | undefined): Promise<{ archived: Promise<unknown> | null }> {
      const archive = await client.mutation(triageApi.settle, { conversationId, ...(anchor !== undefined ? { anchor } : {}) }, { optimisticUpdate: optimistic.settle });
      return { archived: archive ? watchCommandVia(client, archive, "archive") : null };
    },
    async unsettle(conversationId: ConversationId): Promise<void> {
      await client.mutation(triageApi.unsettle, { conversationId }, { optimisticUpdate: optimistic.unsettle });
    },
    async settleAgents(conversationId: ConversationId): Promise<void> {
      await client.mutation(agentApi.settleConversationAgents, { conversationId }, { optimisticUpdate: optimistic.settleAgents });
    },
    async reopenAgents(conversationId: ConversationId): Promise<void> {
      await client.mutation(agentApi.reopenConversationAgents, { conversationId });
    },
    async pin(conversationId: ConversationId, pinned: boolean): Promise<void> {
      await client.mutation(triageApi.setPinned, { conversationId, pinned }, { optimisticUpdate: optimistic.pin });
    },
    async markUnread(conversationId: ConversationId): Promise<void> {
      await client.mutation(triageApi.markUnread, { conversationId }, { optimisticUpdate: optimistic.markUnread });
    },
    /** Later: out of every queue until `until`, or back early on a new message. */
    async snooze(conversationId: ConversationId, until: number): Promise<void> {
      await client.mutation(laterApi.snooze, { conversationId, until }, { optimisticUpdate: optimistic.snooze });
    },
    async unsnooze(conversationId: ConversationId): Promise<void> {
      await client.mutation(laterApi.unsnooze, { conversationId });
    },
    async followUp(conversationId: ConversationId, at: number): Promise<void> {
      await client.mutation(laterApi.setFollowUp, { conversationId, at });
    },
    async clearFollowUp(conversationId: ConversationId): Promise<void> {
      await client.mutation(laterApi.clearFollowUp, { conversationId });
    },
    /** Reads in Convex at once; resolves when the Mini has sent iMessage's read receipt, and rejects if it could not. */
    async read(conversationId: ConversationId): Promise<void> {
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
