import { v, type Infer, type PropertyValidators } from "convex/values";

/**
 * Comma's iMessage mirror. chat.db on the Mini stays the source of truth; the
 * bridge writes these rows through internal mutations, and clients read them
 * through auth-gated queries. Shapes follow apps/imsg/shared/types.ts.
 */

export const participant = v.object({
  address: v.string(),
  name: v.union(v.string(), v.null()),
});

export const reaction = v.object({
  type: v.string(),
  emoji: v.optional(v.string()),
  isFromMe: v.boolean(),
  senderName: v.union(v.string(), v.null()),
  senderAddress: v.union(v.string(), v.null()),
});

export const mention = v.object({
  start: v.number(),
  length: v.number(),
  address: v.string(),
});

export const specialContent = v.union(
  v.object({ kind: v.literal("contact"), name: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("location") }),
  v.object({ kind: v.literal("apple-cash") }),
  v.object({ kind: v.literal("poll") }),
  v.object({ kind: v.literal("unknown"), label: v.string() }),
);

export const lastMessageSummary = v.object({
  guid: v.string(),
  text: v.string(),
  dateCreated: v.number(),
  isFromMe: v.boolean(),
  senderName: v.union(v.string(), v.null()),
  hasAttachments: v.boolean(),
});

/** A raw tapback row's target; the folded result lives on the target's `reactions`. */
export const tapback = v.object({
  targetGuid: v.string(),
  reaction: v.string(),
  emoji: v.optional(v.string()),
  remove: v.boolean(),
});

export const conversationFields = {
  /** `dm:+E164`, `dm:email`, `g:identifier`, or `chat:guid`; see convex/comma/conversationKey.ts. */
  conversationKey: v.string(),
  primaryChatGuid: v.string(),
  chatGuids: v.array(v.string()),
  displayName: v.string(),
  rawDisplayName: v.optional(v.string()),
  groupPhotoGuid: v.optional(v.string()),
  groupPhotoStorageId: v.optional(v.id("_storage")),
  isGroup: v.boolean(),
  participants: v.array(participant),
  lastMessage: v.optional(lastMessageSummary),
  lastMessageAt: v.number(),
  isSpam: v.boolean(),
  hasGroupPhoto: v.boolean(),
  /** Mirrored from chat.db: inbound messages newer than the last read or sent one. */
  unread: v.optional(v.object({ count: v.number(), firstAt: v.number() })),
  updatedAt: v.number(),
};

export const chatAliasFields = {
  chatGuid: v.string(),
  conversationId: v.id("comma_conversations"),
  service: v.string(),
};

export const messageFields = {
  guid: v.string(),
  conversationId: v.id("comma_conversations"),
  chatGuid: v.string(),
  dateCreated: v.number(),
  dateRead: v.optional(v.number()),
  dateDelivered: v.optional(v.number()),
  dateEdited: v.optional(v.number()),
  dateRetracted: v.optional(v.number()),
  isFromMe: v.boolean(),
  text: v.string(),
  service: v.union(v.literal("iMessage"), v.literal("SMS")),
  sender: v.optional(participant),
  error: v.number(),
  edited: v.boolean(),
  retracted: v.boolean(),
  isTapback: v.boolean(),
  /** Top-level copy of tapback.targetGuid so it can be indexed. */
  tapbackTargetGuid: v.optional(v.string()),
  tapback: v.optional(tapback),
  reactions: v.array(reaction),
  replyToGuid: v.optional(v.string()),
  replyToPreview: v.optional(v.string()),
  replyToFromMe: v.optional(v.boolean()),
  isGroupEvent: v.boolean(),
  isSpam: v.optional(v.boolean()),
  special: v.optional(specialContent),
  sendEffect: v.optional(v.string()),
  mentions: v.array(mention),
  attachmentGuids: v.array(v.string()),
  /** Outbox key, set when the bridge matches an echo to a queued send. */
  clientKey: v.optional(v.string()),
  /** Bridge-assigned monotonic revision; upserts skip when existing >= incoming. */
  sourceVersion: v.number(),
};

export const attachmentFields = {
  guid: v.string(),
  messageGuid: v.string(),
  conversationId: v.id("comma_conversations"),
  mimeType: v.optional(v.string()),
  filename: v.optional(v.string()),
  transferName: v.optional(v.string()),
  uti: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  totalBytes: v.optional(v.number()),
  /** chat.db transfer_state; 5 means the file is on the Mini's disk. */
  transferState: v.optional(v.number()),
  isSticker: v.boolean(),
  hideAttachment: v.boolean(),
  isOnDisk: v.boolean(),
  thumbStorageId: v.optional(v.id("_storage")),
  originalStorageId: v.optional(v.id("_storage")),
  transcript: v.optional(v.string()),
  transcriptState: v.optional(v.union(v.literal("not-requested"), v.literal("working"), v.literal("ready"), v.literal("unavailable"), v.literal("failed"))),
  transcriptError: v.optional(v.string()),
  transcriptDetail: v.optional(v.string()),
  sourceVersion: v.number(),
};

export const conversationStateFields = {
  conversationId: v.id("comma_conversations"),
  dismissedUnrespondedGuid: v.optional(v.string()),
  dismissedWaitingGuid: v.optional(v.string()),
  mutedUnresponded: v.boolean(),
  markedUnread: v.boolean(),
  pinned: v.boolean(),
  readAt: v.number(),
  updatedAt: v.number(),
};

export const triageEventFields = {
  conversationId: v.id("comma_conversations"),
  messageGuid: v.string(),
  reason: v.union(v.literal("reply"), v.literal("dismiss")),
  clearedAt: v.number(),
};

export const triageOpenFields = {
  conversationId: v.id("comma_conversations"),
  messageGuid: v.string(),
  openedAt: v.number(),
};

export const scheduledStatus = v.union(
  v.literal("pending"),
  v.literal("in-progress"),
  v.literal("complete"),
  v.literal("failed"),
  v.literal("interrupted"),
  v.literal("expired"),
);

const suggestionModel = v.union(v.literal("opus"), v.literal("terra"));

export const replySuggestion = v.object({
  id: v.string(),
  kind: v.union(v.literal("text"), v.literal("reaction")),
  strategy: v.string(),
  vibe: v.string(),
  text: v.string(),
  reaction: v.union(v.string(), v.null()),
  targetMessageGuid: v.union(v.string(), v.null()),
  targetMessagePreview: v.union(v.string(), v.null()),
  targetPartIndex: v.union(v.number(), v.null()),
});

export const eventSuggestion = v.object({
  title: v.string(),
  start: v.string(),
  durationMinutes: v.number(),
  location: v.union(v.string(), v.null()),
  inviteEmails: v.array(v.string()),
});

export const suggestionPayload = v.object({
  suggestions: v.array(replySuggestion),
  event: v.union(eventSuggestion, v.null()),
  recipeVersion: v.number(),
  selectedModel: suggestionModel,
  servedModel: suggestionModel,
  fallback: v.boolean(),
  noReply: v.boolean(),
});

/** Strict wire choices; legacy mirrored shelves retain their permissive validators. */
export const commandReplySuggestion = v.object({
  ...replySuggestion.fields,
  strategy: v.union(v.literal("answer"), v.literal("clarify"), v.literal("advance"), v.literal("defer"), v.literal("decline"), v.literal("close"), v.literal("react")),
  vibe: v.union(v.literal("curious"), v.literal("affirmative"), v.literal("cautious"), v.literal("boundary"), v.literal("playful")),
  reaction: v.union(v.literal("love"), v.literal("like"), v.literal("dislike"), v.literal("laugh"), v.literal("emphasize"), v.literal("question"), v.null()),
});

export const suggestionFeedback = v.object({
  suggestion: commandReplySuggestion,
  selectedModel: suggestionModel,
  servedModel: suggestionModel,
  recipeVersion: v.number(),
  selectedAt: v.number(),
  finalText: v.string(),
});

const sendPayload = v.object({
  kind: v.literal("send"),
  text: v.string(),
  replyToGuid: v.optional(v.string()),
  replyToPart: v.optional(v.number()),
  mentions: v.optional(v.array(mention)),
});
const reactPayload = v.object({
  kind: v.literal("react"),
  messageGuid: v.string(),
  reaction: v.string(),
  partIndex: v.optional(v.number()),
  remove: v.boolean(),
  suggested: v.optional(v.boolean()),
});
const editPayload = v.object({
  kind: v.literal("edit"),
  messageGuid: v.string(),
  text: v.string(),
  partIndex: v.optional(v.number()),
});
const messageTargetPayload = <K extends "unsend" | "delete">(kind: K) =>
  v.object({ kind: v.literal(kind), messageGuid: v.string(), partIndex: v.optional(v.number()) });
const flagPayload = <K extends "markRead" | "markUnread" | "settle" | "unsettle">(kind: K) =>
  v.object({ kind: v.literal(kind), messageGuid: v.optional(v.string()) });
const togglePayload = <K extends "pin" | "mute">(kind: K) => v.object({ kind: v.literal(kind), value: v.boolean() });
const renamePayload = v.object({ kind: v.literal("rename"), name: v.string() });
const schedulePayload = v.object({ kind: v.literal("schedule"), text: v.string(), sendAt: v.number() });
const editScheduledPayload = v.object({
  kind: v.literal("editScheduled"),
  bbId: v.number(),
  text: v.string(),
  sendAt: v.number(),
});
const cancelScheduledPayload = v.object({ kind: v.literal("cancelScheduled"), bbId: v.number() });

export const outboxPayload = v.union(
  sendPayload,
  reactPayload,
  editPayload,
  messageTargetPayload("unsend"),
  messageTargetPayload("delete"),
  flagPayload("markRead"),
  flagPayload("markUnread"),
  flagPayload("settle"),
  flagPayload("unsettle"),
  togglePayload("pin"),
  togglePayload("mute"),
  renamePayload,
  schedulePayload,
  editScheduledPayload,
  cancelScheduledPayload,
  v.object({ kind: v.literal("createChat"), addresses: v.array(v.string()), text: v.string() }),
  v.object({ kind: v.literal("sendContact"), name: v.string(), address: v.string(), caption: v.optional(v.string()) }),
  v.object({ kind: v.literal("sendAttachment"), storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), caption: v.optional(v.string()), isAudioMessage: v.boolean() }),
  v.object({ kind: v.literal("participant"), address: v.string(), action: v.union(v.literal("add"), v.literal("remove")) }),
  v.object({ kind: v.literal("leaveGroup") }),
  v.object({ kind: v.literal("deleteChat"), chatGuid: v.string() }),
  v.object({ kind: v.literal("sendScheduledNow"), bbId: v.number() }),
  v.object({ kind: v.literal("transcribe"), attachmentGuid: v.string() }),
  v.object({ kind: v.literal("createFaceTimeLink") }),
  v.object({ kind: v.literal("typing"), active: v.boolean(), expiresAt: v.number() }),
  v.object({ kind: v.literal("suggestions"), model: suggestionModel, refresh: v.boolean() }),
  v.object({ kind: v.literal("suggestionFeedback"), feedback: suggestionFeedback }),
  v.object({ kind: v.literal("clearSuggestionLearning") }),
  v.object({ kind: v.literal("identify") }),
);

/**
 * `unknown` is a send whose outcome the bridge could not determine (for
 * example it crashed after handing the text to BlueBubbles). BlueBubbles'
 * tempGuid is not persisted, so these are never retried automatically.
 */
export const outboxStatus = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("unknown"),
);

/** Wire Message, exactly as the REST mapper returns it. */
export const commandMessage = v.object({
  guid: v.string(), chatGuid: v.string(), text: v.string(), dateCreated: v.number(),
  dateRead: v.union(v.number(), v.null()), dateDelivered: v.union(v.number(), v.null()),
  isFromMe: v.boolean(), service: v.union(v.literal("iMessage"), v.literal("SMS")),
  sender: v.union(participant, v.null()),
  attachments: v.array(v.object({
    guid: v.string(), thumbUrl: v.optional(v.union(v.string(), v.null())), originalUrl: v.optional(v.union(v.string(), v.null())),
    mimeType: v.union(v.string(), v.null()), filename: v.union(v.string(), v.null()),
    width: v.union(v.number(), v.null()), height: v.union(v.number(), v.null()), totalBytes: v.union(v.number(), v.null()),
  })),
  mentions: v.optional(v.array(mention)), special: v.union(specialContent, v.null()), sendEffect: v.union(v.string(), v.null()),
  reactions: v.array(reaction), replyToGuid: v.union(v.string(), v.null()), replyToPreview: v.union(v.string(), v.null()),
  isAssociatedMessage: v.optional(v.boolean()), replyToFromMe: v.union(v.boolean(), v.null()), isGroupEvent: v.boolean(),
  isSpam: v.optional(v.boolean()), error: v.number(), edited: v.boolean(), retracted: v.boolean(),
  pending: v.optional(v.boolean()), failed: v.optional(v.boolean()), clientKey: v.optional(v.string()),
});

export const commandScheduled = v.object({
  id: v.number(), chatGuid: v.string(), chatName: v.string(), text: v.string(), sendAt: v.number(),
  status: scheduledStatus, error: v.union(v.string(), v.null()), sentAt: v.union(v.number(), v.null()),
});
export const transcriptState = v.union(
  v.object({ state: v.literal("not-requested") }), v.object({ state: v.literal("working") }),
  v.object({ state: v.literal("ready"), text: v.string() }),
  v.object({ state: v.literal("unavailable"), detail: v.string() }),
  v.object({ state: v.literal("failed"), error: v.string() }),
);
export const commandSuggestions = v.object({
  ...suggestionPayload.fields,
  suggestions: v.array(commandReplySuggestion),
  basedOnMessageGuid: v.union(v.string(), v.null()), stale: v.boolean(), generatedAt: v.number(),
});
const okResult = <K extends string>(kind: K) => v.object({ kind: v.literal(kind), ok: v.literal(true) });
const messageResult = <K extends string>(kind: K) => v.object({ kind: v.literal(kind), message: commandMessage });
export const commandResult = v.union(
  messageResult("send"), messageResult("sendContact"), messageResult("sendAttachment"), messageResult("createFaceTimeLink"),
  v.object({ kind: v.literal("createChat"), chatGuid: v.string(), service: v.literal("iMessage"), isGroup: v.boolean(), participants: v.array(v.string()), message: commandMessage }),
  v.object({ kind: v.literal("schedule"), scheduled: commandScheduled }),
  v.object({ kind: v.literal("editScheduled"), scheduled: commandScheduled }),
  v.object({ kind: v.literal("transcribe"), transcript: transcriptState }),
  v.object({ kind: v.literal("suggestions"), suggestions: commandSuggestions }),
  v.object({ kind: v.literal("identify"), contact: v.object({ name: v.union(v.string(), v.null()), confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")), reasoning: v.string() }) }),
  okResult("react"), okResult("edit"), okResult("unsend"), okResult("delete"),
  okResult("markRead"), okResult("markUnread"), okResult("settle"), okResult("unsettle"),
  okResult("pin"), okResult("mute"), okResult("rename"), okResult("cancelScheduled"),
  okResult("participant"), okResult("leaveGroup"), okResult("deleteChat"), okResult("sendScheduledNow"),
  okResult("typing"), okResult("suggestionFeedback"), okResult("clearSuggestionLearning"),
);
export type CommandResult = Infer<typeof commandResult>;

export const outboxFields = {
  clientKey: v.string(),
  conversationId: v.optional(v.id("comma_conversations")),
  payload: outboxPayload,
  status: outboxStatus,
  leaseUntil: v.optional(v.number()),
  claimToken: v.optional(v.string()),
  attempts: v.number(),
  error: v.optional(v.string()),
  resultGuid: v.optional(v.string()),
  result: v.optional(commandResult),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const draftFields = {
  conversationId: v.id("comma_conversations"),
  text: v.string(),
  updatedAt: v.number(),
};

export const scheduledFields = {
  bbId: v.number(),
  conversationId: v.optional(v.id("comma_conversations")),
  chatGuid: v.string(),
  text: v.string(),
  sendAt: v.number(),
  status: scheduledStatus,
  error: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  updatedAt: v.number(),
};

export const suggestionFields = {
  /** Missing on legacy shelves; consumers treat it as opus. */
  model: v.optional(suggestionModel),
  conversationId: v.id("comma_conversations"),
  anchorGuid: v.string(),
  payload: suggestionPayload,
  createdAt: v.number(),
};

export const presenceFields = {
  conversationId: v.id("comma_conversations"), peerTyping: v.boolean(), updatedAt: v.number(), expiresAt: v.number(),
};
export const bridgeStateFields = {
  key: v.literal("mini"), privateApi: v.boolean(), suggestions: v.boolean(), reactionSuggestions: v.boolean(),
  whisperAvailable: v.boolean(), whisperDetail: v.optional(v.string()), lastSeenAt: v.number(),
};
export const uploadFields = {
  storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), totalBytes: v.number(), createdAt: v.number(),
  commandId: v.optional(v.id("comma_outbox")),
};

export const syncStateFields = {
  key: v.string(),
  cursor: v.optional(v.string()),
  lastEventAt: v.optional(v.number()),
  lastReconcileAt: v.optional(v.number()),
  counts: v.optional(v.record(v.string(), v.number())),
  updatedAt: v.number(),
};

function withSystemFields<T extends PropertyValidators, Table extends string>(table: Table, fields: T) {
  return v.object({ _id: v.id(table), _creationTime: v.number(), ...fields });
}

export const conversationDoc = withSystemFields("comma_conversations", conversationFields);
export const messageDoc = withSystemFields("comma_messages", messageFields);
export const attachmentDoc = withSystemFields("comma_attachments", attachmentFields);
export const conversationStateDoc = withSystemFields("comma_conversation_state", conversationStateFields);
export const draftDoc = withSystemFields("comma_drafts", draftFields);
export const scheduledDoc = withSystemFields("comma_scheduled", scheduledFields);
export const suggestionDoc = withSystemFields("comma_suggestions", suggestionFields);
export const syncStateDoc = withSystemFields("comma_sync_state", syncStateFields);
export const outboxDoc = withSystemFields("comma_outbox", outboxFields);

export type CommaParticipant = Infer<typeof participant>;
export type CommaReaction = Infer<typeof reaction>;
export type CommaTapback = Infer<typeof tapback>;
export type CommaOutboxPayload = Infer<typeof outboxPayload>;
export type CommaOutboxStatus = Infer<typeof outboxStatus>;
export type CommaConversationDoc = Infer<typeof conversationDoc>;
export type CommaMessageDoc = Infer<typeof messageDoc>;
export type CommaAttachmentDoc = Infer<typeof attachmentDoc>;
export type CommaConversationStateDoc = Infer<typeof conversationStateDoc>;
export type CommaScheduledDoc = Infer<typeof scheduledDoc>;
export type CommaSuggestionPayload = Infer<typeof suggestionPayload>;

export const commandReceipt = v.object({
  commandId: v.id("comma_outbox"),
  clientKey: v.string(),
  status: outboxStatus,
  error: v.optional(v.string()),
  result: v.optional(commandResult),
  updatedAt: v.number(),
});

export type CommandReceipt = Infer<typeof commandReceipt>;
