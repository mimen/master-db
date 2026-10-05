import { expect, test } from "bun:test";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ChatSummary } from "@shared/types";

import { ChatDirectoryContext, useConversationRef } from "./use-chat-directory";

const known = {
  conversationId: "conv-known", guid: "iMessage;-;+1555", displayName: "Known", isGroup: false, known: true,
  isSpam: false, participants: [], unreadCount: 0,
  lastMessage: { guid: "m1", text: "hi", dateCreated: 1234, isFromMe: false, senderName: null, hasAttachments: false },
  flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
} satisfies ChatSummary;

test("a chat the directory knows opens without a resolveChat round trip; an unknown one resolves", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const watched: string[] = [];
  const client = {
    watchQuery: (ref: FunctionReference<"query">, args: { chatGuid: string }) => {
      watched.push(`${getFunctionName(ref)} ${args.chatGuid}`);
      return {
        onUpdate: () => () => undefined,
        localQueryResult: () => ({ _id: "conv-resolved", lastMessage: { dateCreated: 99 } }),
        journal: () => undefined,
      };
    },
  } as unknown as ConvexReactClient;
  let ref: ReturnType<typeof useConversationRef> | undefined;
  function Probe({ guid }: { guid: string }) {
    ref = useConversationRef(guid);
    return null;
  }
  const root = createRoot(globalThis.document.getElementById("root")!);
  const render = (guid: string) => act(async () => {
    root.render(createElement(ConvexProvider, { client },
      createElement(ChatDirectoryContext.Provider, { value: [known] }, createElement(Probe, { guid }))));
  });
  try {
    await render(known.guid);
    expect(ref).toEqual({ conversationId: "conv-known" as never, lastMessageAt: 1234, resolving: false });
    expect(watched).toEqual([]);

    await render("iMessage;-;+1999");
    expect(ref).toEqual({ conversationId: "conv-resolved" as never, lastMessageAt: 99, resolving: false });
    expect(new Set(watched)).toEqual(new Set(["comma/queries:resolveChat iMessage;-;+1999"]));
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, globals);
  }
});
