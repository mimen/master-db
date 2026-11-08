import { conversationRoute } from "@shared/imessage";
import { support, type Feature, type Support } from "@shared/platform-profile";
import type { ChatSummary } from "@shared/types";
import { useCallback } from "react";

import { useRouteStatus } from "@/lib/presence-api";

import { bridgeSupport } from "./use-health";

export type RouteSupport = (feature: Feature) => Support | null;

/** What the conversation's route can do, per its platform profile and its executor's live capabilities. Null before it loads. */
export function useRouteSupport(chat: Pick<ChatSummary, "route" | "isGroup"> | null | undefined): RouteSupport {
  const { privateApi, emojiReactions } = bridgeSupport(useRouteStatus(chat?.route));
  // The callback keys on the profile route's fields, not the chat object, so it survives list re-renders.
  const route = chat ? conversationRoute(chat) : null;
  const platform = route?.platform;
  const service = route?.service;
  const isGroup = route?.isGroup ?? false;
  return useCallback(
    (feature: Feature) => platform === undefined || service === undefined ? null
      : support({ platform, service, isGroup }, feature, { privateApi, emojiReactions }),
    [platform, service, isGroup, privateApi, emojiReactions],
  );
}
