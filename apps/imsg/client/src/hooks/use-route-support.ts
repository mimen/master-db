import { conversationRoute } from "@shared/imessage";
import { support, type Feature, type Support } from "@shared/platform-profile";
import type { ChatSummary } from "@shared/types";
import { useCallback } from "react";

import { useBridgeState } from "@/lib/presence-api";

import { usePrivateApi } from "./use-health";

export type RouteSupport = (feature: Feature) => Support | null;

/** What the conversation's route can do, per its platform profile and the Mac's live capabilities. Null before it loads. */
export function useRouteSupport(chat: Pick<ChatSummary, "route" | "isGroup"> | null | undefined): RouteSupport {
  const privateApi = usePrivateApi();
  const emojiReactions = useBridgeState()?.emojiReactions ?? false;
  // The callback keys on the route's fields, not the chat object, so it survives list re-renders.
  const platform = chat?.route.platform;
  const accountId = chat?.route.accountId ?? null;
  const chatGuid = chat?.route.imessage.chatGuid;
  const isGroup = chat?.isGroup ?? false;
  return useCallback(
    (feature: Feature) => platform === undefined || chatGuid === undefined ? null
      : support(conversationRoute({ route: { platform, accountId, imessage: { chatGuid } }, isGroup }), feature, { privateApi, emojiReactions }),
    [platform, accountId, chatGuid, isGroup, privateApi, emojiReactions],
  );
}
