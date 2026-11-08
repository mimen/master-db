import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { personName } from "../identity/names";

import { soleAccountScope } from "./accounts";
import { imessage, primaryChat, routeFor } from "./conversationIdentity";
import { findByHandle, findConversation } from "./conversationLookup";
import { personForAddress } from "./photos";

const service = v.union(v.literal("iMessage"), v.literal("SMS"));

export const findChat = query({
  args: { address: v.string(), service: v.optional(service) },
  returns: v.union(v.null(), v.object({
    conversationId: v.id("comma_conversations"), chatGuid: v.string(), service, isGroup: v.literal(false), participants: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const found = await findByHandle(ctx, await soleAccountScope(ctx, imessage.platform), args.address);
    const conversation = found && !found.isGroup && found.participants.length === 1 ? found : null;
    const route = conversation && routeFor(conversation, args.service);
    return route ? { conversationId: conversation._id, chatGuid: route.chatGuid, service: imessage.sendService(route.chatGuid),
      isGroup: false as const, participants: conversation.participants.map((p) => p.address) } : null;
  },
});

export const chatInfo = query({
  args: { conversationId: v.optional(v.id("comma_conversations")), chatGuid: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({
    guid: v.string(), displayName: v.union(v.string(), v.null()), isGroup: v.boolean(),
    participants: v.array(v.object({ address: v.string(), name: v.string(), is_favorite: v.optional(v.boolean()) })),
  })),
  handler: async (ctx, ref) => {
    await assertAllowed(ctx);
    const conversation = await findConversation(ctx, ref);
    if (!conversation) return null;
    const participants = (await conversationPeople(ctx, conversation)).map(({ address, name, person }) => ({
      address, name, ...(person?.is_favorite !== undefined ? { is_favorite: person.is_favorite } : {}),
    }));
    return { guid: ref.chatGuid ?? primaryChat(conversation), displayName: conversation.rawDisplayName || null, isGroup: conversation.isGroup, participants };
  },
});

/** Each participant with their contact, named the way the app names them. */
export async function conversationPeople(ctx: QueryCtx, conversation: Doc<"comma_conversations">) {
  return await Promise.all(conversation.participants.map(async (participant) => {
    const person = await personForAddress(ctx, participant.address);
    return { address: participant.address, name: personName(person) ?? participant.address, person };
  }));
}
