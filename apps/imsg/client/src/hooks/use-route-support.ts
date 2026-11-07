import { conversationRoute } from "@shared/imessage";
import { support, type Feature, type Support } from "@shared/platform-profile";
import type { ChatSummary } from "@shared/types";
import { useCallback } from "react";

import { useBridgeState } from "@/lib/presence-api";

import { usePrivateApi } from "./use-health";

export type RouteSupport = (feature: Feature) => Support | null;

/** What the conversation's route can do, per its platform profile and the Mac's live capabilities. Null before it loads. */
export function useRouteSupport(chat: Pick<ChatSummary, "imessage" | "isGroup"> | null | undefined): RouteSupport {
  const privateApi = usePrivateApi();
  const emojiReactions = useBridgeState()?.emojiReactions ?? false;
  const chatGuid = chat?.imessage.chatGuid;
  const isGroup = chat?.isGroup ?? false;
  return useCallback(
    (feature: Feature) => chatGuid === undefined ? null : support(conversationRoute({ imessage: { chatGuid }, isGroup }), feature, { privateApi, emojiReactions }),
    [chatGuid, isGroup, privateApi, emojiReactions],
  );
}
