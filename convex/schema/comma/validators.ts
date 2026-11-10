import { v, type Infer, type PropertyValidators } from "convex/values";

/**
 * Comma's iMessage mirror. chat.db on the Mini stays the source of truth; the
 * bridge writes these rows through internal mutations, and clients read them
 * through auth-gated queries. Shapes follow apps/imsg/shared/types.ts.
 */

/** The service that carries a conversation. */
export const platform = v.union(v.literal("imessage"), v.literal("slack"), v.literal("gmail"));

/** One signed-in identity on a platform: an iMessage Mac, a Slack workspace, a mailbox. Credentials arrive with OAuth. */
export const accountHealth = v.union(v.literal("ok"), v.literal("needsAttention"));
/**
 * The Google OAuth app a mailbox connected through. `workspace` is the internal app for the AUF Workspace, whose grants
 * last; `personal` is the external app in Testing mode for a gmail.com mailbox, whose grants Google ends after 7 days.
 */
export const gmailApp = v.union(v.literal("workspace"), v.literal("personal"));
export type GmailApp = Infer<typeof gmailApp>;
/** An OAuth token, AES-GCM encrypted under COMMA_TOKEN_KEY (convex/comma/credentials.ts). Only internal actions open it. */
export const sealedCredentials = v.object({ keyVersion: v.number(), iv: v.string(), ciphertext: v.string() });
export const accountFields = {
  platform,
  /** The platform's own id for the account, unique within the platform. */
  externalId: v.string(),
  label: v.string(),
  /** The handles that are the user on this account; where a platform says nothing, a sender among them is "me". */
  selfHandles: v.array(v.string()),
  health: accountHealth,
  createdAt: v.number(),
  /** Absent on the iMessage account, which needs none, and on an account that was disconnected. */
  credentials: v.optional(sealedCredentials),
  /** Slack channels whose top-level messages Comma keeps. Elsewhere it keeps only DMs and Milad's threads. */
  slackChannels: v.optional(v.array(v.string())),
  /** The Google app a mailbox last connected through, and when. Absent on a mailbox from before G4: the workspace app. */
  gmailGrant: v.optional(v.object({ app: gmailApp, grantedAt: v.number() })),
};

/** A Slack event_id already received, so a retry is dropped. The backstop prunes old ones. */
export const slackEventFields = { eventId: v.string(), receivedAt: v.number() };

/** A single-use OAuth state: an authed client asked to connect, and the platform's callback must name it before it expires. */
export const oauthStateFields = {
  state: v.string(), platform, expiresAt: v.number(),
  /** Google's PKCE code verifier; the callback sends it with the code. */
  verifier: v.optional(v.string()),
  /** The Google app the consent URL named; the callback exchanges the code with the same one. */
  gmailApp: v.optional(gmailApp),
};

/**
 * Where a command executes: the platform, the account, and that platform's own thread id. Convex chooses it; a
 * bridge only runs it. `accountId` is absent on routes stamped before accounts and on conversations not yet backfilled.
 */
export const route = v.union(
  v.object({ platform: v.literal("imessage"), accountId: v.optional(v.id("comma_accounts")), chatGuid: v.string() }),
  /** A Slack channel, DM or group DM, and the thread inside it when the conversation is one thread. */
  v.object({ platform: v.literal("slack"), accountId: v.id("comma_accounts"), channel: v.string(), threadTs: v.optional(v.string()) }),
  /** A Gmail thread in one mailbox. */
  v.object({ platform: v.literal("gmail"), accountId: v.id("comma_accounts"), threadId: v.string() }),
);

export const participant = v.object({
  address: v.string(),
  name: v.union(v.string(), v.null()),
});

/** A reaction as every reader sees it, whatever platform carried it. */
export const reaction = v.object({
  /** The reaction's identity on its platform, and what a react command sends: an iMessage tapback name, or `emoji:` and an emoji tapback's emoji. */
  key: v.string(),
  /** How it looks, when it is a Unicode emoji. */
  emoji: v.optional(v.string()),
  isFromMe: v.boolean(),
  senderName: v.union(v.string(), v.null()),
  senderAddress: v.union(v.string(), v.null()),
  /** For clients built before `key`: the tapback name, or "emoji". Drop once every client reads `key`. */
  type: v.optional(v.string()),
});

/** The folded tapbacks stored on a message row before comma_reactions existed. Nothing reads them. */
export const legacyReaction = v.object({
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

/** A conversation's shape. iMessage has dms and groups; Slack channels, Slack threads and email threads are their own kinds. */
export const conversationKind = v.union(v.literal("dm"), v.literal("group"), v.literal("channel"), v.literal("thread"), v.literal("emailThread"));
export type CommaConversationKind = Infer<typeof conversationKind>;

export const lastMessageSummary = v.object({
  guid: v.string(),
  text: v.string(),
  dateCreated: v.number(),
  isFromMe: v.boolean(),
  senderName: v.union(v.string(), v.null()),
  hasAttachments: v.boolean(),
  /** The message names the user; a Slack channel needs the user only then. */
  mentionsMe: v.optional(v.boolean()),
});

/** What a tapback the bridge posts does. Ingest writes it to comma_reactions and stores no message row. */
export const tapback = v.object({
  targetGuid: v.string(),
  reaction: v.string(),
  emoji: v.optional(v.string()),
  remove: v.boolean(),
});

/** Bulk mail (newsletters, notifications, promotions) stays out of the People lens and Today. Replying lifts a thread out. */
export const gmailThreadFields = v.object({
  threadId: v.string(), subject: v.string(), inInbox: v.boolean(), bulk: v.boolean(),
  /** Why Gmail refused Comma's last archive or unarchive, which Comma then took back. The thread's next sync clears it. */
  archiveError: v.optional(v.string()),
  /** Messages carrying Gmail's UNREAD label; absent when none do. Gmail is the source, so reading there clears it. */
  unread: v.optional(v.number()),
  /** Gmail's historyId for the newest read written, so a slower, older read of the thread never undoes it. */
  historyId: v.optional(v.string()),
});

export const conversationFields = {
  /** Every stored row has one. Optional because test fixtures across convex/comma still omit it. */
  platform: v.optional(platform),
  /** Absent on rows written before accounts; they are the platform's only account's until the backfill stamps them. */
  accountId: v.optional(v.id("comma_accounts")),
  /** Unique within an account. `dm:+E164`, `dm:email`, `g:identifier`, or `chat:guid`; see convex/comma/conversationIdentity.ts. */
  conversationKey: v.string(),
  /** iMessage's: the chat a conversation sends through, and every chat merged into it. Other platforms have neither. */
  primaryChatGuid: v.optional(v.string()),
  chatGuids: v.optional(v.array(v.string())),
  /**
   * Slack's: the channel, DM or group DM, and the root of the thread when the conversation is one thread. `following`
   * is false on a thread kept only because its channel is opted in; absent on threads from before S3, which Milad follows.
   */
  slack: v.optional(v.object({ channel: v.string(), threadTs: v.optional(v.string()), following: v.optional(v.boolean()) })),
  /** Gmail's: the thread, its subject, whether its newest message is in the inbox, and whether it is bulk mail. */
  gmail: v.optional(gmailThreadFields),
  displayName: v.string(),
  rawDisplayName: v.optional(v.string()),
  groupPhotoGuid: v.optional(v.string()),
  groupPhotoStorageId: v.optional(v.id("_storage")),
  /** Absent on rows written before kinds until the kinds backfill stamps them; read it through `conversationKind`. */
  kind: v.optional(conversationKind),
  /** Derived from `kind` at ingest: anything but a dm. Kept for readers and clients built before kinds. */
  isGroup: v.boolean(),
  participants: v.array(participant),
  lastMessage: v.optional(lastMessageSummary),
  lastMessageAt: v.number(),
  isSpam: v.boolean(),
  /** iMessage's; absent reads as no photo. */
  hasGroupPhoto: v.optional(v.boolean()),
  /** Mirrored from chat.db: inbound messages newer than the last read or sent one. */
  unread: v.optional(v.object({ count: v.number(), firstAt: v.number() })),
  /**
   * Set on what the Messages list never shows, so its index skips them: an email thread (Mail lists it) and a Slack
   * thread Milad doesn't follow (its channel holds it). Rows from before it get it from the unlisted backfill.
   */
  unlisted: v.optional(v.literal(true)),
  updatedAt: v.number(),
};

export const chatAliasFields = {
  /** Absent on rows written before accounts, which are all iMessage. */
  platform: v.optional(platform),
  accountId: v.optional(v.id("comma_accounts")),
  chatGuid: v.string(),
  conversationId: v.id("comma_conversations"),
  service: v.string(),
};

/**
 * What a platform adapter derives from a raw message for the models, at ingest (`ToModelText` in
 * apps/imsg/shared/model-text.ts). Absent where the platform's `text` already reads cleanly, as on iMessage.
 */
export const modelTextFields = {
  /** The body a model reads in place of `text`: the new content first, quoted history, signatures and markup gone. */
  modelText: v.optional(v.string()),
  /** An email's subject. */
  subject: v.optional(v.string()),
  /** The thread inside the conversation the message belongs to, as the platform names it. */
  threadRef: v.optional(v.string()),
};

/**
 * What any platform's message has. `guid` is the platform's message id, unique within its account; other tables
 * name a message by `messageKey`. iMessage's own fields live in `imessage`.
 */
export const messageCoreFields = {
  /** Absent on rows written before platforms existed, which are all iMessage. */
  platform: v.optional(platform),
  /** Absent on rows written before accounts; see conversationFields.accountId. */
  accountId: v.optional(v.id("comma_accounts")),
  guid: v.string(),
  conversationId: v.id("comma_conversations"),
  dateCreated: v.number(),
  dateRead: v.optional(v.number()),
  dateDelivered: v.optional(v.number()),
  dateEdited: v.optional(v.number()),
  dateRetracted: v.optional(v.number()),
  isFromMe: v.boolean(),
  text: v.string(),
  ...modelTextFields,
  sender: v.optional(participant),
  edited: v.boolean(),
  retracted: v.boolean(),
  replyToGuid: v.optional(v.string()),
  replyToPreview: v.optional(v.string()),
  replyToFromMe: v.optional(v.boolean()),
  /** Slack's: how many replies the thread this message starts holds in Comma. */
  replyCount: v.optional(v.number()),
  isGroupEvent: v.boolean(),
  mentions: v.array(mention),
  attachmentGuids: v.array(v.string()),
  /** Outbox key, set when the bridge matches an echo to a queued send. */
  clientKey: v.optional(v.string()),
  /** Bridge-assigned monotonic revision; upserts skip when existing >= incoming. */
  sourceVersion: v.number(),
};

/** iMessage's own message fields, stored under `imessage`. */
export const imessageMessageFields = {
  chatGuid: v.string(),
  service: v.union(v.literal("iMessage"), v.literal("SMS")),
  /** BlueBubbles' send error code; 0 when none. */
  error: v.number(),
  isSpam: v.optional(v.boolean()),
  special: v.optional(specialContent),
  sendEffect: v.optional(v.string()),
  /** An associated message such as a tapback. Ingest stores only the ones it cannot turn into a reaction, and nothing shows them. */
  isAssociatedMessage: v.boolean(),
};
export const imessageMessage = v.object(imessageMessageFields);

/** The flat iMessage fields of the form bridges posted before accounts, which every row written before them carries. */
const flatImessageMessageFields = {
  chatGuid: imessageMessageFields.chatGuid,
  service: imessageMessageFields.service,
  error: imessageMessageFields.error,
  isSpam: imessageMessageFields.isSpam,
  special: imessageMessageFields.special,
  sendEffect: imessageMessageFields.sendEffect,
  isTapback: v.boolean(),
  /** Nothing reads it. */
  tapbackTargetGuid: v.optional(v.string()),
  tapback: v.optional(tapback),
  /** Folded tapbacks from before comma_reactions; nothing reads them. */
  reactions: v.optional(v.array(legacyReaction)),
};

const { platform: _platform, accountId: _accountId, ...postedCoreFields } = messageCoreFields;

/** One message as a bridge posts it. The call names the platform and account; a tapback becomes a reaction. */
export const messageInput = v.object({
  ...postedCoreFields,
  imessage: v.object({ ...imessageMessageFields, tapback: v.optional(tapback) }),
});

/** The flat form bridges built before accounts post. Ingest converts it; drop once the Mini posts messageInput. */
export const legacyMessageInput = v.object({ ...messageCoreFields, ...flatImessageMessageFields });

/** Where a pending send stands; see apps/imsg/shared/pending-send.ts. */
export const pendingSendState = v.union(v.literal("queued"), v.literal("sending"), v.literal("notSent"), v.literal("failed"));
export type CommaPendingSendState = Infer<typeof pendingSendState>;

/** Gmail's own message fields: its addresses, whether it is bulk, and its HTML cleaned for the reader (emailHtml.ts). */
export const gmailMessageFields = v.object({
  from: participant,
  to: v.array(participant),
  cc: v.array(participant),
  bulk: v.boolean(),
  html: v.optional(v.string()),
  /** Remote images the cleaned HTML holds back until the reader asks for them. */
  blockedImages: v.optional(v.number()),
});

/**
 * A stored message: the core, its platform's side object, and, on rows the backfill has not reached, the flat
 * iMessage fields instead. Read iMessage fields through messageShape.ts. Only a pending send's own row carries `sendState`.
 */
export const messageRowFields = {
  ...messageCoreFields,
  /** Computed at ingest: a mention names one of the account's selfHandles. Absent on rows written before it. */
  mentionsMe: v.optional(v.boolean()),
  imessage: v.optional(imessageMessage),
  gmail: v.optional(gmailMessageFields),
  chatGuid: v.optional(flatImessageMessageFields.chatGuid),
  service: v.optional(flatImessageMessageFields.service),
  error: v.optional(flatImessageMessageFields.error),
  isSpam: flatImessageMessageFields.isSpam,
  special: flatImessageMessageFields.special,
  sendEffect: flatImessageMessageFields.sendEffect,
  isTapback: v.optional(flatImessageMessageFields.isTapback),
  tapbackTargetGuid: flatImessageMessageFields.tapbackTargetGuid,
  tapback: flatImessageMessageFields.tapback,
  reactions: flatImessageMessageFields.reactions,
  sendState: v.optional(pendingSendState),
};

/**
 * One sender's reaction to one message: the newest state for that target, sender and key. A removal
 * stays as a tombstone so an older add that arrives late cannot bring the reaction back. A sender has at
 * most one live reaction per message, as in Messages: a newer one leaves their others as tombstones.
 */
export const reactionFields = {
  platform,
  conversationId: v.id("comma_conversations"),
  /** The reacted-to message's `messageKey`. Its row may not have arrived yet. */
  targetKey: v.string(),
  key: v.string(),
  emoji: v.optional(v.string()),
  isFromMe: v.boolean(),
  /** Absent on my own reactions, which share one sender whatever address sent them. */
  senderAddress: v.optional(v.string()),
  /** When the event that set this state happened. An older event never overwrites it. */
  at: v.number(),
  removed: v.boolean(),
};
export const reactionState = v.object(reactionFields);

export const attachmentCoreFields = {
  /** Absent on rows written before platforms, which are all iMessage. */
  platform: v.optional(platform),
  accountId: v.optional(v.id("comma_accounts")),
  guid: v.string(),
  messageGuid: v.string(),
  conversationId: v.id("comma_conversations"),
  mimeType: v.optional(v.string()),
  filename: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  totalBytes: v.optional(v.number()),
  /** The platform says not to show it. */
  hideAttachment: v.boolean(),
  thumbStorageId: v.optional(v.id("_storage")),
  originalStorageId: v.optional(v.id("_storage")),
  transcript: v.optional(v.string()),
  transcriptState: v.optional(v.union(v.literal("not-requested"), v.literal("working"), v.literal("ready"), v.literal("unavailable"), v.literal("failed"))),
  transcriptError: v.optional(v.string()),
  transcriptDetail: v.optional(v.string()),
  sourceVersion: v.number(),
};

/** chat.db's own attachment fields, stored under `imessage`. */
export const imessageAttachmentFields = {
  transferName: v.optional(v.string()),
  uti: v.optional(v.string()),
  /** chat.db transfer_state; 5 means the file is on the Mini's disk. */
  transferState: v.optional(v.number()),
  isSticker: v.boolean(),
  isOnDisk: v.boolean(),
};
export const imessageAttachment = v.object(imessageAttachmentFields);

const { platform: _attachmentPlatform, accountId: _attachmentAccountId, ...postedAttachmentFields } = attachmentCoreFields;

/** One attachment as a bridge posts it; the call names the platform and account. */
export const attachmentInput = v.object({ ...postedAttachmentFields, imessage: imessageAttachment });

/** The flat form bridges built before accounts post. Drop once the Mini posts attachmentInput. */
export const legacyAttachmentInput = v.object({ ...attachmentCoreFields, ...imessageAttachmentFields });

/**
 * Gmail's own attachment fields: the MIME part it came from, and its Content-ID when the HTML body shows it inline
 * (`cid:`), in which case the reader draws it in the body, not as a tile.
 */
export const gmailAttachmentFields = v.object({ partId: v.string(), contentId: v.optional(v.string()), inline: v.boolean() });

/** A stored attachment; rows the backfill has not reached keep chat.db's fields flat. Read them through messageShape.ts. */
export const attachmentFields = {
  ...attachmentCoreFields,
  gmail: v.optional(gmailAttachmentFields),
  imessage: v.optional(imessageAttachment),
  transferName: imessageAttachmentFields.transferName,
  uti: imessageAttachmentFields.uti,
  transferState: imessageAttachmentFields.transferState,
  isSticker: v.optional(imessageAttachmentFields.isSticker),
  isOnDisk: v.optional(imessageAttachmentFields.isOnDisk),
};

export const snoozeReturnReason = v.union(v.literal("time"), v.literal("message"));

export const conversationStateFields = {
  conversationId: v.id("comma_conversations"),
  dismissedUnrespondedGuid: v.optional(v.string()),
  dismissedWaitingGuid: v.optional(v.string()),
  mutedUnresponded: v.boolean(),
  markedUnread: v.boolean(),
  pinned: v.boolean(),
  readAt: v.number(),
  updatedAt: v.number(),
  /** Later, in Comma only: Gmail keeps the thread in its inbox. `job` is the wake scheduled for `until`. */
  snooze: v.optional(v.object({ until: v.number(), setAt: v.number(), job: v.id("_scheduled_functions") })),
  snoozeReturn: v.optional(v.object({ reason: snoozeReturnReason, until: v.number(), at: v.number() })),
  /** `job` fires at `at` and is gone once the follow-up is due. */
  followUp: v.optional(v.object({ at: v.number(), since: v.number(), due: v.boolean(), job: v.optional(v.id("_scheduled_functions")) })),
};

/** What a client sees of a conversation's deferrals: shared/chat-state.ts laterOf. */
export const laterView = v.object({
  snoozedUntil: v.optional(v.number()),
  returned: v.optional(v.object({ reason: snoozeReturnReason, until: v.number(), at: v.number() })),
  followUp: v.optional(v.object({ at: v.number(), since: v.number(), due: v.boolean() })),
});

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
  /** A reaction key from the route's platform profile. */
  reaction: v.union(v.string(), v.null()),
});

export const suggestionFeedback = v.object({
  suggestion: commandReplySuggestion,
  selectedModel: suggestionModel,
  servedModel: suggestionModel,
  recipeVersion: v.number(),
  selectedAt: v.number(),
  finalText: v.string(),
});

/** A file a sent email carries, already in Convex storage: an upload, or an attachment Comma holds. */
export const emailAttachment = v.object({ storageId: v.id("_storage"), filename: v.string(), mimeType: v.string() });
export const emailFields = v.object({
  to: v.array(v.string()), cc: v.array(v.string()), subject: v.string(), attachments: v.optional(v.array(emailAttachment)),
});

export const sendPayload = v.object({
  kind: v.literal("send"),
  text: v.string(),
  replyToGuid: v.optional(v.string()),
  replyToPart: v.optional(v.number()),
  mentions: v.optional(v.array(mention)),
  /** An email's recipients and subject. A Gmail send needs them; no other platform reads them. */
  email: v.optional(emailFields),
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
/** BlueBubbles' scheduling, iMessage's only. Comma schedules Slack and Gmail itself (comma/scheduledSends). */
const schedulePayload = v.object({ kind: v.literal("schedule"), text: v.string(), sendAt: v.number() });
const editScheduledPayload = v.object({
  kind: v.literal("editScheduled"),
  bbId: v.number(),
  text: v.string(),
  sendAt: v.number(),
});
const cancelScheduledPayload = v.object({ kind: v.literal("cancelScheduled"), bbId: v.number() });

/** Kinds every messaging platform executes. */
export const coreMessagingPayload = v.union(
  sendPayload,
  reactPayload,
  editPayload,
  messageTargetPayload("unsend"),
  messageTargetPayload("delete"),
  flagPayload("markRead"),
  renamePayload,
  schedulePayload,
  v.object({ kind: v.literal("createChat"), addresses: v.array(v.string()), text: v.string() }),
  v.object({ kind: v.literal("sendAttachment"), storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), caption: v.optional(v.string()), isAudioMessage: v.boolean() }),
  v.object({ kind: v.literal("typing"), active: v.boolean(), expiresAt: v.number() }),
);

/** Kinds only iMessage supports: BlueBubbles' scheduled ids, contact cards, group membership, chat aliases and FaceTime. */
export const imessagePayload = v.union(
  editScheduledPayload,
  cancelScheduledPayload,
  v.object({ kind: v.literal("sendScheduledNow"), bbId: v.number() }),
  v.object({ kind: v.literal("sendContact"), name: v.string(), address: v.string(), caption: v.optional(v.string()) }),
  v.object({ kind: v.literal("participant"), address: v.string(), action: v.union(v.literal("add"), v.literal("remove")) }),
  v.object({ kind: v.literal("leaveGroup") }),
  v.object({ kind: v.literal("deleteChat"), chatGuid: v.string() }),
  v.object({ kind: v.literal("createFaceTimeLink") }),
);

/**
 * Gmail's own: a thread leaves the inbox when it is settled in Comma, and returns when it is unsettled. `sendEmail`
 * starts a new thread from a mailbox (a new email or a forward), so it names its account and no conversation.
 */
export const gmailPayload = v.union(
  // `anchor`: the message the settle covered. Only it and the messages before it leave the inbox.
  v.object({ kind: v.literal("archive"), anchor: v.optional(v.string()) }), v.object({ kind: v.literal("unarchive") }),
  v.object({ kind: v.literal("sendEmail"), accountId: v.id("comma_accounts"), text: v.string(), email: emailFields }),
);

/** Model work. It reads the conversation from Convex and never touches a messaging platform. */
export const aiPayload = v.union(
  /** `precompute` is Convex's own, queued on an inbound message; it counts against the AI process's daily cap. */
  v.object({ kind: v.literal("suggestions"), model: suggestionModel, refresh: v.boolean(), precompute: v.optional(v.boolean()) }),
  v.object({ kind: v.literal("suggestionFeedback"), feedback: suggestionFeedback }),
  v.object({ kind: v.literal("clearSuggestionLearning") }),
  v.object({ kind: v.literal("identify") }),
  v.object({ kind: v.literal("transcribe"), attachmentGuid: v.string() }),
  /** Convex's own, queued once a person's messages go quiet; it counts against the AI process's daily cap. */
  v.object({ kind: v.literal("personSummary"), personId: v.id("people") }),
);

/** Triage kinds from clients older than comma/triage. Convex applies them; no lane executes them. */
export const legacyTriagePayload = v.union(
  flagPayload("markUnread"),
  flagPayload("settle"),
  flagPayload("unsettle"),
  togglePayload("pin"),
  togglePayload("mute"),
);

export const outboxPayload = v.union(
  ...coreMessagingPayload.members,
  ...imessagePayload.members,
  ...gmailPayload.members,
  ...aiPayload.members,
  ...legacyTriagePayload.members,
);

/**
 * The executor a command waits for. One lane per messaging platform, one for model work someone asked for, and
 * `aiBackground` for model work nobody waits on (suggestion precompute, person summaries), so it never holds back a user's command.
 */
export const outboxLane = v.union(v.literal("imessage"), v.literal("slack"), v.literal("gmail"), v.literal("ai"), v.literal("aiBackground"));

const AI_KINDS: ReadonlySet<string> = new Set(aiPayload.members.map((member) => member.fields.kind.value));
/** Model work, which waits in the ai lane whatever the conversation's platform. */
export const isAiKind = (kind: Infer<typeof outboxPayload>["kind"]): boolean => AI_KINDS.has(kind);

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
/** A Slack conversation: a channel, DM or group DM, or one thread in a channel. */
export const slackRef = v.union(
  v.object({ type: v.union(v.literal("im"), v.literal("mpim"), v.literal("channel")), channel: v.string() }),
  v.object({ type: v.literal("thread"), channel: v.string(), threadTs: v.string() }),
);

/** `image` is the profile picture the user set; a Slack default avatar parses as none. */
export const slackUser = v.object({ id: v.string(), name: v.string(), email: v.optional(v.string()), image: v.optional(v.string()) });

/** A file on a Slack message. Its URLs answer only with the user token; Slack leaves them out when it won't share the file. */
export const slackFile = v.object({
  id: v.string(), name: v.optional(v.string()), mimeType: v.optional(v.string()), size: v.optional(v.number()),
  width: v.optional(v.number()), height: v.optional(v.number()), url: v.optional(v.string()), thumbUrl: v.optional(v.string()),
});

/** One Slack message as Comma keeps it. `clientKey` is a Comma send's own, read back from the message's metadata. */
export const slackMessage = v.object({
  ts: v.string(), threadTs: v.optional(v.string()), user: v.string(), text: v.string(), editedTs: v.optional(v.string()), clientKey: v.optional(v.string()),
  files: v.optional(v.array(slackFile)),
});

/** One Gmail message as ingest writes it: gmailMessage.ts's parse of what Gmail returned or what Comma sent. */
export const gmailMessageValue = v.object({
  id: v.string(), threadId: v.string(), internalDate: v.number(), labelIds: v.array(v.string()), from: participant,
  to: v.array(participant), cc: v.array(participant), subject: v.string(), snippet: v.string(), bulk: v.boolean(), text: v.string(),
  html: v.optional(v.string()), blockedImages: v.optional(v.number()), model: v.object(modelTextFields),
  /** Its attachment parts, from a full read. A sent one names the stored file it was built from. Absent on results stored before attachments. */
  attachments: v.optional(v.array(v.object({
    ...gmailAttachmentFields.fields, filename: v.string(), mimeType: v.string(), size: v.number(), storageId: v.optional(v.id("_storage")),
  }))),
});

const okResult = <K extends string>(kind: K) => v.object({ kind: v.literal(kind), ok: v.literal(true) });
const messageResult = <K extends string>(kind: K) => v.object({ kind: v.literal(kind), message: commandMessage });
export const commandResult = v.union(
  messageResult("send"), v.object({ kind: v.literal("send"), guid: v.string(), slack: slackMessage }),
  v.object({ kind: v.literal("send"), guid: v.string(), gmail: gmailMessageValue }),
  v.object({ kind: v.literal("sendEmail"), guid: v.string(), gmail: gmailMessageValue }), messageResult("sendContact"), messageResult("sendAttachment"), messageResult("createFaceTimeLink"),
  v.object({ kind: v.literal("createChat"), conversationId: v.optional(v.id("comma_conversations")), chatGuid: v.string(), service: v.literal("iMessage"), isGroup: v.boolean(), participants: v.array(v.string()), message: commandMessage }),
  v.object({ kind: v.literal("schedule"), scheduled: commandScheduled }),
  v.object({ kind: v.literal("editScheduled"), scheduled: commandScheduled }),
  v.object({ kind: v.literal("transcribe"), transcript: transcriptState }),
  v.object({ kind: v.literal("suggestions"), suggestions: commandSuggestions }),
  v.object({ kind: v.literal("identify"), contact: v.object({ name: v.union(v.string(), v.null()), confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")), reasoning: v.string() }) }),
  okResult("react"), okResult("edit"), okResult("unsend"), okResult("delete"),
  okResult("markRead"), okResult("markUnread"), okResult("settle"), okResult("unsettle"),
  okResult("pin"), okResult("mute"), okResult("rename"), okResult("cancelScheduled"),
  okResult("participant"), okResult("leaveGroup"), okResult("deleteChat"), okResult("sendScheduledNow"),
  okResult("typing"), okResult("suggestionFeedback"), okResult("clearSuggestionLearning"), okResult("archive"), okResult("unarchive"),
  okResult("personSummary"),
);
export type CommandResult = Infer<typeof commandResult>;

export const outboxFields = {
  clientKey: v.string(),
  conversationId: v.optional(v.id("comma_conversations")),
  /** Stamped at enqueue for every conversation command; the bridge sends through exactly this. */
  route: v.optional(route),
  payload: outboxPayload,
  /** Absent only on rows queued before lanes. */
  lane: v.optional(outboxLane),
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

export const draftAttachment = v.object({ storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), size: v.number() });
export const draftSource = v.union(v.literal("user"), v.literal("agent"));

/** What sits in a conversation's composer: the user's unsent text or a draft an agent prepared. */
export const draftFields = {
  conversationId: v.id("comma_conversations"),
  text: v.string(),
  updatedAt: v.number(),
  /** Absent on rows written before agent drafts existed, which are all the user's. */
  source: v.optional(draftSource),
  /** The agent's private context for the user. Shown above the composer, never sent. */
  note: v.optional(v.string()),
  attachments: v.optional(v.array(draftAttachment)),
  /** The agent chat that wrote the draft; sending it settles that chat. */
  agentChatId: v.optional(v.id("comma_agent_chats")),
};

/**
 * A scheduled message: BlueBubbles' own for iMessage (`bbId`, mirrored by replaceScheduled), or one Comma schedules
 * for Slack and Gmail (`payload`, sent by comma/scheduledSends at `sendAt`).
 */
export const scheduledFields = {
  /** Absent on rows written before accounts, which are all iMessage. */
  platform: v.optional(platform),
  accountId: v.optional(v.id("comma_accounts")),
  bbId: v.optional(v.number()),
  conversationId: v.optional(v.id("comma_conversations")),
  chatGuid: v.optional(v.string()),
  /** The send Comma queues at `sendAt`. Its text is always the row's. */
  payload: v.optional(sendPayload),
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
/** What an executor can do beyond running its lane, per executor. */
export const executorCapabilities = v.union(
  /** The Mini's bridge, for one iMessage account: what its BlueBubbles can send. */
  v.object({ executor: v.literal("imessage"), privateApi: v.boolean(), emojiReactions: v.boolean() }),
  /** Slack's account: Convex runs its lane, and the Events webhook and OAuth report its connection. */
  v.object({ executor: v.literal("slack") }),
  /** A Gmail mailbox: Convex runs its lane; sync and the watch renewal report its connection. */
  v.object({ executor: v.literal("gmail") }),
  /** The Mini's AI process: reply suggestions through the gateway, and local Whisper. */
  v.object({ executor: v.literal("ai"), suggestions: v.boolean(), whisperAvailable: v.boolean(), whisperDetail: v.optional(v.string()) }),
);

/**
 * One executor's connection, keyed `<platform>:<accountId>` for a platform account's executor and `ai` for model work.
 * `connected` is the executor's own word; a reader judges it stale by `lastSeenAt`.
 */
export const executorStatusFields = {
  key: v.string(), connected: v.boolean(), lastSeenAt: v.number(), detail: v.optional(v.string()), capabilities: executorCapabilities,
};

/** The Mini's single row from before per-executor status. A publish in this shape is translated, and its row removed. */
export const legacyBridgeStateFields = {
  key: v.literal("mini"), privateApi: v.boolean(), emojiReactions: v.optional(v.boolean()), suggestions: v.boolean(), reactionSuggestions: v.boolean(),
  whisperAvailable: v.boolean(), whisperDetail: v.optional(v.string()), lastSeenAt: v.number(),
};
export const uploadFields = {
  storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), totalBytes: v.number(), createdAt: v.number(),
  commandId: v.optional(v.id("comma_outbox")),
};

export const syncStateFields = {
  /** The account whose sync this is; absent on global rows and on iMessage's rows from before accounts. */
  accountId: v.optional(v.id("comma_accounts")),
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

export const accountDoc = withSystemFields("comma_accounts", accountFields);
export const conversationDoc = withSystemFields("comma_conversations", conversationFields);
export const messageDoc = withSystemFields("comma_messages", messageRowFields);
export const attachmentDoc = withSystemFields("comma_attachments", attachmentFields);
export const conversationStateDoc = withSystemFields("comma_conversation_state", conversationStateFields);
export const draftView = withSystemFields("comma_drafts", {
  ...draftFields,
  attachments: v.optional(v.array(v.object({ ...draftAttachment.fields, url: v.union(v.string(), v.null()) }))),
});
export const draftListItem = v.object({
  conversationId: v.id("comma_conversations"), text: v.string(), updatedAt: v.number(),
  source: draftSource, note: v.optional(v.string()), attachmentCount: v.number(),
});
export const scheduledDoc = withSystemFields("comma_scheduled", scheduledFields);
export const suggestionDoc = withSystemFields("comma_suggestions", suggestionFields);
export const syncStateDoc = withSystemFields("comma_sync_state", syncStateFields);
export const outboxDoc = withSystemFields("comma_outbox", outboxFields);

export type CommaPlatform = Infer<typeof platform>;
export type CommaRoute = Infer<typeof route>;
export type CommaParticipant = Infer<typeof participant>;
export type CommaReaction = Infer<typeof reaction>;
export type CommaLegacyReaction = Infer<typeof legacyReaction>;
export type CommaReactionState = Infer<typeof reactionState>;
export type CommaTapback = Infer<typeof tapback>;
export type CommaOutboxPayload = Infer<typeof outboxPayload>;
export type CommaOutboxStatus = Infer<typeof outboxStatus>;
export type CommaOutboxLane = Infer<typeof outboxLane>;
export type CommaExecutorStatus = Infer<ReturnType<typeof v.object<typeof executorStatusFields>>>;
export type CoreMessagingKind = Infer<typeof coreMessagingPayload>["kind"];
export type IMessageOnlyKind = Infer<typeof imessagePayload>["kind"];
export type GmailOnlyKind = Infer<typeof gmailPayload>["kind"];
export type AiKind = Infer<typeof aiPayload>["kind"];
export type LegacyTriageKind = Infer<typeof legacyTriagePayload>["kind"];
export type CommaAccountDoc = Infer<typeof accountDoc>;
export type CommaConversationDoc = Infer<typeof conversationDoc>;
export type CommaImessageMessage = Infer<typeof imessageMessage>;
export type CommaImessageAttachment = Infer<typeof imessageAttachment>;
export type CommaMessageInput = Infer<typeof messageInput>;
export type CommaLegacyMessageInput = Infer<typeof legacyMessageInput>;
export type CommaAttachmentInput = Infer<typeof attachmentInput>;
export type CommaLegacyAttachmentInput = Infer<typeof legacyAttachmentInput>;
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

/** The agent runner's liveness row in comma_bridge_state, beside the Mini bridge's. */
export const agentBridgeStateFields = { key: v.literal("agent"), updatedAt: v.number() };

export const agentEffort = v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("xhigh"), v.literal("max"));
export const agentChatState = v.union(
  v.literal("idle"), v.literal("pending"), v.literal("running"), v.literal("waiting_input"), v.literal("interrupted"), v.literal("failed"),
);

export const agentChatFields = {
  conversationId: v.id("comma_conversations"),
  /** Reserved through ccs and set by the runner. */
  sessionId: v.optional(v.string()),
  state: agentChatState,
  /** The last ask's selection; the runner applies each message's own. */
  model: v.string(),
  effort: agentEffort,
  /** Newest thread message dateCreated the agent has been given. */
  seenThroughMessageAt: v.optional(v.number()),
  /** Absent while the chat is open. */
  settledAt: v.optional(v.number()),
  /** True when the latest conversation settle closed the chat, so un-settling the conversation reopens it. */
  settledWithConversation: v.optional(v.boolean()),
  /** Generated by the runner after the first ask. */
  title: v.optional(v.string()),
  /** When the user last saw the chat's finished turn. */
  seenAt: v.optional(v.number()),
  lastTurnEndedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const agentQuestion = v.object({
  question: v.string(), header: v.optional(v.string()), multiSelect: v.boolean(),
  options: v.array(v.object({ label: v.string(), description: v.optional(v.string()) })),
});
export const agentAnswers = v.record(v.string(), v.string());

export const agentAttachment = draftAttachment;
const { filename, mimeType, size } = draftAttachment.fields;
export const agentUserEntry = v.object({
  kind: v.literal("user"), text: v.string(), steer: v.boolean(), attachments: v.optional(v.array(v.object({ filename, mimeType, size }))),
});
export const agentAssistantEntry = v.object({ kind: v.literal("assistant"), text: v.string(), streaming: v.boolean() });
export const agentThinkingEntry = v.object({ kind: v.literal("thinking"), text: v.string(), streaming: v.boolean() });
export const agentToolEntry = v.object({
  kind: v.literal("tool"), name: v.string(), summary: v.string(), detail: v.optional(v.string()),
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
  /** JSON of the tool input, clipped like detail. Absent for credential reads. */
  input: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
});
/** The root agent's TodoWrite list, one item per turn. */
export const agentTodosEntry = v.object({
  kind: v.literal("todos"),
  todos: v.array(v.object({
    content: v.string(), activeForm: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("in_progress"), v.literal("completed")),
  })),
});
export const agentQuestionEntry = v.object({
  kind: v.literal("question"), requestId: v.string(), questions: v.array(agentQuestion),
  status: v.union(v.literal("pending"), v.literal("resolved"), v.literal("cancelled")),
  answers: v.optional(agentAnswers),
});
export const agentDraftPlacement = v.union(v.literal("composer"), v.literal("pane"));
export const agentDraftEntry = v.object({
  kind: v.literal("draft"), text: v.string(), note: v.optional(v.string()), attachments: v.optional(v.array(draftAttachment)),
  placed: agentDraftPlacement, used: v.boolean(),
});
export const agentTurnEndEntry = v.object({
  kind: v.literal("turn_end"), outcome: v.union(v.literal("completed"), v.literal("interrupted"), v.literal("failed")),
  error: v.optional(v.string()), durationMs: v.optional(v.number()),
  /** The selection that answered the turn. */
  model: v.optional(v.string()), effort: v.optional(agentEffort),
});
export const agentEntry = v.union(
  agentUserEntry, agentAssistantEntry, agentThinkingEntry, agentToolEntry, agentQuestionEntry, agentDraftEntry, agentTurnEndEntry,
  agentTodosEntry,
);

export const agentItemFields = {
  chatId: v.id("comma_agent_chats"),
  /** Chosen by the writer: an SDK uuid or tool_use_id from the runner, a crypto uuid from the client. */
  key: v.string(),
  /** max(ordinal) + 1 within the chat, assigned on insert. */
  ordinal: v.number(),
  entry: agentEntry,
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** model, effort and attachments are absent on commands written before per-message selection. */
export const agentMessageCommand = v.object({
  kind: v.literal("message"), text: v.string(), steer: v.boolean(),
  model: v.optional(v.string()), effort: v.optional(agentEffort), attachments: v.optional(v.array(agentAttachment)),
});
export const agentAnswerCommand = v.object({ kind: v.literal("answer"), requestId: v.string(), answers: agentAnswers });
export const agentStopCommand = v.object({ kind: v.literal("stop") });
/** Emitted by New chat for the archived chat's live session. */
export const agentCloseCommand = v.object({ kind: v.literal("close") });
export const agentCommand = v.union(agentMessageCommand, agentAnswerCommand, agentStopCommand, agentCloseCommand);

export const agentCommandFields = {
  chatId: v.id("comma_agent_chats"),
  command: agentCommand,
  status: v.union(v.literal("pending"), v.literal("taken")),
  createdAt: v.number(),
  takenAt: v.optional(v.number()),
};

export const agentChatDoc = withSystemFields("comma_agent_chats", agentChatFields);
export const agentItemDoc = withSystemFields("comma_agent_items", agentItemFields);
const { conversationId, sessionId, model, effort, state, seenThroughMessageAt, title } = agentChatFields;
/** A message attachment as the runner downloads it; url is null once the file is gone from storage. */
export const agentAttachmentLink = v.object({ url: v.union(v.string(), v.null()), filename, mimeType, size });
export const pendingAgentCommandBody = v.union(
  v.object({ ...agentMessageCommand.fields, attachments: v.optional(v.array(agentAttachmentLink)) }),
  agentAnswerCommand, agentStopCommand, agentCloseCommand,
);
export const pendingAgentCommand = v.object({
  _id: v.id("comma_agent_commands"), chatId: v.id("comma_agent_chats"), command: pendingAgentCommandBody, createdAt: v.number(),
  chat: v.object({ conversationId, sessionId, model, effort, state, seenThroughMessageAt, title }),
});

const { settledAt, seenAt, lastTurnEndedAt, createdAt, updatedAt } = agentChatFields;
export const agentPreview = v.object({
  kind: v.union(v.literal("question"), v.literal("draft"), v.literal("reply"), v.literal("thinking"), v.literal("error")),
  /** At most 200 characters. */
  text: v.string(),
});
/** An agent chat as lists show it. title falls back to the clipped first ask until the runner names the chat. */
export const agentChatSummary = v.object({
  _id: v.id("comma_agent_chats"), conversationId, title: v.string(), state, model, effort, settledAt, seenAt, lastTurnEndedAt, createdAt, updatedAt,
  preview: v.optional(agentPreview),
});

export type DraftAttachment = Infer<typeof draftAttachment>;
export type AgentEffort = Infer<typeof agentEffort>;
export type AgentChatState = Infer<typeof agentChatState>;
export type AgentQuestion = Infer<typeof agentQuestion>;
export type AgentDraftPlacement = Infer<typeof agentDraftPlacement>;
export type AgentEntry = Infer<typeof agentEntry>;
export type AgentAttachment = Infer<typeof agentAttachment>;
export type AgentAttachmentLink = Infer<typeof agentAttachmentLink>;
export type PendingAgentCommandBody = Infer<typeof pendingAgentCommandBody>;
export type AgentCommand = Infer<typeof agentCommand>;
export type AgentChatDoc = Infer<typeof agentChatDoc>;
export type AgentItemDoc = Infer<typeof agentItemDoc>;
export type PendingAgentCommand = Infer<typeof pendingAgentCommand>;
export type AgentPreview = Infer<typeof agentPreview>;
export type AgentChatSummary = Infer<typeof agentChatSummary>;

/** The private CRM layer: a group's own row, a DM's person. Absent when nothing is set. */
export const conversationCrmView = v.object({
  is_favorite: v.optional(v.boolean()),
  priority: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
});

/** One row per America/Los_Angeles day in comma_today_queue. See apps/imsg/docs/today-queue.md. */
export const todayGroup = v.object({ id: v.string(), title: v.string(), context: v.string() });
export const todayItem = v.object({
  conversationId: v.id("comma_conversations"),
  /** 1..n, dense in display order at build time; gaps appear only live. */
  rank: v.number(),
  group: v.string(),
  reason: v.string(),
  /** The newest message guid the build read for this thread; absent on items built before it was stored. */
  anchor: v.optional(v.string()),
});
export const todayQueue = v.object({
  /** When the candidate read began; every "since the build" rule compares to this. */
  snapshotAt: v.number(),
  model: v.string(),
  brief: v.string(),
  groups: v.array(todayGroup),
  items: v.array(todayItem),
  /** Every known Needs you conversation at the snapshot, before any cap. */
  openAtSnapshot: v.array(v.id("comma_conversations")),
  /** Threads the model read. */
  readCount: v.number(),
  /** Every candidate at the snapshot, Needs you and Waiting; absent on queues built before it was stored. */
  candidateCount: v.optional(v.number()),
  /**
   * The model session this queue came from. startedAt is its fresh build's snapshot, possibly on an earlier day, and
   * updates counts the Updates since then. Absent on queues built before sessions.
   */
  session: v.optional(v.object({ id: v.string(), startedAt: v.number(), updates: v.number() })),
});
/** update continues the model session; fresh starts a new one. */
export const todayMode = v.union(v.literal("update"), v.literal("fresh"));
const todaySource = v.union(v.literal("schedule"), v.literal("user"));
/** Absent on runs stored before modes, which were all fresh. */
const mode = v.optional(todayMode);
export const todayRun = v.union(
  v.object({ status: v.literal("requested"), attempt: v.number(), source: todaySource, mode, requestedAt: v.number() }),
  v.object({ status: v.literal("building"), attempt: v.number(), source: todaySource, mode, requestedAt: v.number(), startedAt: v.number(), claimId: v.string() }),
  v.object({ status: v.literal("done"), attempt: v.number(), source: todaySource, mode, finishedAt: v.number() }),
  v.object({ status: v.literal("failed"), attempt: v.number(), source: todaySource, mode, failedAt: v.number(), error: v.string() }),
);
export const todayQueueFields = {
  day: v.string(),
  /** That day's local midnight, epoch ms; the progress window. */
  dayStart: v.number(),
  /** The latest attempt. */
  run: todayRun,
  /** The latest successful build for this day. */
  queue: v.optional(todayQueue),
};
export const todayView = v.object({
  day: v.string(),
  dayStart: v.number(),
  run: todayRun,
  queue: v.union(todayQueue, v.null()),
  /** The latest clear per conversation since dayStart. */
  cleared: v.array(v.object({ conversationId: v.id("comma_conversations"), at: v.number() })),
});
export const todayCandidate = v.object({
  conversationId: v.id("comma_conversations"),
  title: v.string(),
  isGroup: v.boolean(),
  kind: conversationKind,
  platform,
  state: v.union(v.literal("needsYou"), v.literal("waiting")),
  lastMessageAt: v.number(),
  unreadCount: v.number(),
  crm: v.optional(conversationCrmView),
});

export type TodayGroup = Infer<typeof todayGroup>;
export type TodayItem = Infer<typeof todayItem>;
export type TodayQueue = Infer<typeof todayQueue>;
export type TodayRun = Infer<typeof todayRun>;
export type TodayMode = Infer<typeof todayMode>;
export type TodayView = Infer<typeof todayView>;
export type TodayCandidate = Infer<typeof todayCandidate>;

/**
 * A person's written summary across platforms, rebuilt by the AI process once their messages go quiet. `dueAt` is
 * set exactly while a rebuild is scheduled; `conversationId` is where their newest real message arrived.
 */
export const personSummary = v.object({
  text: v.string(),
  points: v.array(v.string()),
  model: v.string(),
  generatedAt: v.number(),
  /** The newest message the summary read. */
  basedOnAt: v.number(),
});
export const personSummaryFields = {
  personId: v.id("people"),
  conversationId: v.optional(v.id("comma_conversations")),
  dueAt: v.optional(v.number()),
  summary: v.optional(personSummary),
};
