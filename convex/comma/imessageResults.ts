import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { ingestAccount } from "./accounts";
import { imessage } from "./conversationIdentity";
import { messageKey } from "./reactions";
import { applyReaction } from "./reactionStore";

/** What a confirmed iMessage command changes in Convex that no BlueBubbles event will report. */
export async function applyIMessageResult(ctx: MutationCtx, row: Doc<"comma_outbox">): Promise<void> {
  const { payload, conversationId, route } = row;
  if (payload.kind !== "react" || !payload.remove || !conversationId) return;
  const account = await ingestAccount(ctx, { platform: imessage.platform, accountId: route?.platform === "imessage" ? route.accountId : undefined });
  // macOS 15 removes a tapback by deleting its chat.db row, so no removal row ever reaches the
  // bridge. The confirmed command is the removal, dated when it was asked for: any add it removes is older.
  await applyReaction(ctx, {
    platform: imessage.platform,
    conversationId,
    targetKey: messageKey(imessage.platform, account._id, payload.messageGuid),
    key: payload.reaction,
    isFromMe: true,
    at: row.createdAt,
    removed: true,
  });
}
