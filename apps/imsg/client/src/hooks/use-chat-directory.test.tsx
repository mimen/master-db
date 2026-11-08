import { expect, test } from "bun:test";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ChatSummary, ConversationId } from "@shared/types";

import { ChatDirectoryContext, useConversation } from "./use-chat-directory";

const known = {
  conversationId: "conv-known" as ConversationId, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;-;+1555" } }, displayName: "Known",
  kind: "dm", isGroup: false, known: true, isSpam: false, participants: [], unreadCount: 0, firstUnreadAt: null,
  lastMessage: { guid: "m1", text: "hi", dateCreated: 1234, isFromMe: false, senderName: null, hasAttachments: false },
  flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
} satisfies ChatSummary;

const fetchedRow = {
  _id: "conv-fetched", primaryChatGuid: "SMS;-;+1999", displayName: "Fetched", isGroup: false, hasGroupPhoto: false,
  groupPhotoUrl: null, participants: [], isSpam: false, lastMessage: null, unreadCount: 0,
  flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
};

test("a conversation the directory lists reads without a query; one it lacks loads through getConversation", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const watched: string[] = [];
  const client = {
    watchQuery: (ref: FunctionReference<"query">, args: { conversationId: string }) => {
      watched.push(`${getFunctionName(ref)} ${args.conversationId}`);
      return {
        onUpdate: () => () => undefined,
        localQueryResult: () => fetchedRow,
        journal: () => undefined,
      };
    },
  } as unknown as ConvexReactClient;
  let seen: ReturnType<typeof useConversation>;
  function Probe({ conversationId }: { conversationId: ConversationId | null }) {
    seen = useConversation(conversationId);
    return null;
  }
  const root = createRoot(globalThis.document.getElementById("root")!);
  const render = (conversationId: ConversationId | null) => act(async () => {
    root.render(createElement(ConvexProvider, { client },
      createElement(ChatDirectoryContext.Provider, { value: [known] }, createElement(Probe, { conversationId }))));
  });
  try {
    await render(known.conversationId);
    expect(seen).toBe(known);
    expect(watched).toEqual([]);

    await render(null);
    expect(seen).toBeNull();
    expect(watched).toEqual([]);

    await render("conv-fetched" as ConversationId);
    expect(seen).toMatchObject({ conversationId: "conv-fetched", route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "SMS;-;+1999" } }, displayName: "Fetched" });
    expect(new Set(watched)).toEqual(new Set(["comma/queries:getConversation conv-fetched"]));
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, globals);
  }
});
