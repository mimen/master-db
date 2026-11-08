import type { BridgeSupport } from "@shared/platform-profile";

import type { ExecutorStatus } from "@/lib/presence-api";

/** What the route's Mac reports its BlueBubbles can send. Nothing, before it reports or for another platform's executor. */
export function bridgeSupport(status: ExecutorStatus | null | undefined): Required<BridgeSupport> {
  const capabilities = status?.capabilities;
  return capabilities?.executor === "imessage"
    ? { privateApi: capabilities.privateApi, emojiReactions: capabilities.emojiReactions }
    : { privateApi: false, emojiReactions: false };
}
