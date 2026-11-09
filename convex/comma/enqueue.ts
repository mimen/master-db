import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";

import { NOT_SENT_AFTER_MS, pendingGuid } from "../../apps/imsg/shared/pending-send";
import { messageService } from "../../apps/imsg/shared/platform-profile";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { CommaOutboxPayload, CommaRoute } from "../schema/comma/validators";

import { sendRoute } from "./conversationIdentity";
import { laneOf, wakeLane } from "./lanes";
import { profileRoute, unsupportedReason } from "./routeSupport";

/**
 * Queues one command for an executor, stamped with its conversation's route and its lane. A send also creates its
 * pending row here, the first step of the lifecycle in pendingSends.ts.
 */

type SendPayload = Extract<CommaOutboxPayload, { kind: "send" }>;

const GLOBAL_KINDS = new Set<CommaOutboxPayload["kind"]>(["createChat", "clearSuggestionLearning", "sendEmail"]);
const expireRef = makeFunctionReference<"mutation", { clientKey: string }, null>("comma/pendingSends:expire");

/** What the user sends: nothing goes out after NOT_SENT_AFTER_MS, so an executor that comes back hours later never sends it. */
export const EXPIRING_KINDS = new Set<CommaOutboxPayload["kind"]>(["send", "sendAttachment", "sendContact", "createChat"]);

/** Idempotent on clientKey. A send shows its pending bubble at once. */
export async function enqueueCommand(ctx: MutationCtx, { clientKey, conversationId, payload }: {
  clientKey: string; conversationId?: Id<"comma_conversations">; payload: CommaOutboxPayload;
}): Promise<{ id: Id<"comma_outbox">; created: boolean }> {
  const existing = await ctx.db
    .query("comma_outbox")
    .withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey))
    .unique();
  if (existing) return { id: existing._id, created: false };
  if (!conversationId && !GLOBAL_KINDS.has(payload.kind)) throw new Error("conversationId is required for this command");
  const conversation = conversationId ? await ctx.db.get(conversationId) : null;
  if (conversationId && !conversation) throw new Error("Conversation not found");
  const route = conversation ? sendRoute(conversation) : undefined;
  const unsupported = conversation && route && unsupportedReason(route, conversation.isGroup, payload);
  if (unsupported) throw new ConvexError(unsupported);
  if (payload.kind === "sendEmail") await checkNewEmail(ctx, payload);
  if (payload.kind === "sendEmail" || payload.kind === "send") await checkEmailFiles(ctx, payload.email);
  const now = Date.now();
  // A new email names its mailbox. ponytail: createChat names no platform, so it is iMessage's until another platform creates chats.
  const platform = route?.platform ?? (payload.kind === "sendEmail" ? "gmail" : "imessage");
  const id = await insertCommand(ctx, { clientKey, conversationId, route, payload, platform, now });
  if (payload.kind === "send" && conversation && route) await createPendingSend(ctx, { conversation, route, clientKey, payload, now });
  if (EXPIRING_KINDS.has(payload.kind)) await ctx.scheduler.runAfter(NOT_SENT_AFTER_MS, expireRef, { clientKey });
  return { id, created: true };
}

/** Gmail's cap on a message's files together. */
export const MAX_EMAIL_FILES_BYTES = 25 * 1024 * 1024;
export const EMAIL_FILES_LIMIT = "The files are over Gmail's 25 MB limit";

/** An email's files over Gmail's cap are refused while the composer still holds them, not after it has closed. */
async function checkEmailFiles(ctx: MutationCtx, email: { attachments?: { storageId: Id<"_storage"> }[] } | undefined): Promise<void> {
  let total = 0;
  for (const { storageId } of email?.attachments ?? []) total += (await ctx.db.system.get(storageId))?.size ?? 0;
  if (total > MAX_EMAIL_FILES_BYTES) throw new ConvexError(EMAIL_FILES_LIMIT);
}

/** A new email goes from a mailbox to someone; Convex refuses it here rather than in the lane. */
async function checkNewEmail(ctx: MutationCtx, payload: Extract<CommaOutboxPayload, { kind: "sendEmail" }>): Promise<void> {
  if ((await ctx.db.get(payload.accountId))?.platform !== "gmail") throw new ConvexError("Choose a mailbox to send from");
  if (!payload.email.to.length && !payload.email.cc.length) throw new ConvexError("An email needs someone to send it to");
}

/** Inserts a pending command into its lane, and starts the lane's executor when Convex runs it. */
export async function insertCommand(ctx: MutationCtx, { platform, now, ...fields }: {
  clientKey: string; conversationId?: Id<"comma_conversations">; route?: CommaRoute; payload: CommaOutboxPayload;
  platform: CommaRoute["platform"]; now: number;
}): Promise<Id<"comma_outbox">> {
  const { lane } = laneOf(platform, fields.payload);
  const id = await ctx.db.insert("comma_outbox", { ...fields, lane, status: "pending", attempts: 0, createdAt: now, updatedAt: now });
  await wakeLane(ctx, lane);
  return id;
}

/** The bubble shows at once, and the sidebar moves with it rather than a platform round trip later. */
async function createPendingSend(ctx: MutationCtx, { conversation, route, clientKey, payload, now }: {
  conversation: Doc<"comma_conversations">; route: CommaRoute; clientKey: string; payload: SendPayload; now: number;
}): Promise<void> {
  // The real row's refreshLastMessage overwrites this preview, and a stranded send stays the preview.
  await ctx.db.patch(conversation._id, {
    lastMessage: { guid: pendingGuid(clientKey), text: payload.text, dateCreated: now, isFromMe: true, senderName: null, hasAttachments: false },
    lastMessageAt: Math.max(conversation.lastMessageAt, now),
  });
  await ctx.db.insert("comma_messages", {
    platform: route.platform,
    ...(route.accountId ? { accountId: route.accountId } : {}),
    guid: pendingGuid(clientKey),
    conversationId: conversation._id,
    dateCreated: now,
    isFromMe: true,
    text: payload.text,
    ...(route.platform === "imessage" ? {
      imessage: {
        chatGuid: route.chatGuid,
        service: messageService(profileRoute(route, conversation.isGroup).service),
        error: 0,
        isAssociatedMessage: false,
      },
    } : {}),
    edited: false,
    retracted: false,
    replyToGuid: payload.replyToGuid,
    isGroupEvent: false,
    mentions: payload.mentions ?? [],
    attachmentGuids: [],
    clientKey,
    sourceVersion: 0,
    sendState: "queued",
  });
}

