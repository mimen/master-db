import type { GenericId } from "convex/values";

import type {
  CommaAttachmentDoc,
  CommaAttachmentInput,
  CommaImessageAttachment,
  CommaImessageMessage,
  CommaLegacyAttachmentInput,
  CommaLegacyMessageInput,
  CommaMessageDoc,
  CommaMessageInput,
  CommaPlatform,
} from "../schema/comma/validators";

/**
 * Messages and attachments in the platform-neutral form: the core plus a per-platform side object. Rows written
 * before accounts keep iMessage's fields flat until the accounts backfill (migrations.ts) nests them, so every
 * reader asks this file instead of reading either form itself. Pure, so the bridge and its fixture share it.
 */

/** The fields the readers below look at, so any row-shaped value (a stored row, a served view) can be read. */
type StoredMessage = Pick<CommaMessageDoc, "platform" | "imessage" | "chatGuid" | "service" | "error" | "isSpam" | "special" | "sendEffect" | "isTapback">;
type StoredAttachment = Pick<CommaAttachmentDoc, "platform" | "imessage" | "transferName" | "uti" | "transferState" | "isSticker" | "isOnDisk" | "filename">;

/** A row's platform and account. A null account matches rows of any account on the platform. */
export interface AccountScope {
  platform: CommaPlatform;
  accountId: GenericId<"comma_accounts"> | null;
}

export function scopeOf(row: { platform?: CommaPlatform; accountId?: GenericId<"comma_accounts"> }): AccountScope {
  return { platform: row.platform ?? "imessage", accountId: row.accountId ?? null };
}

/** Rows written before accounts carry no accountId: they are the platform's only account's until the backfill stamps them. */
export function inScope(row: { platform?: CommaPlatform; accountId?: GenericId<"comma_accounts"> }, scope: AccountScope): boolean {
  return (row.platform ?? "imessage") === scope.platform &&
    (row.accountId === undefined || scope.accountId === null || row.accountId === scope.accountId);
}

/** A message's iMessage fields, from its side object or its flat legacy fields; undefined on another platform's row. */
export function messageImessage(row: StoredMessage): CommaImessageMessage | undefined {
  if (row.imessage) return row.imessage;
  if (row.chatGuid === undefined || row.service === undefined) return undefined;
  return {
    chatGuid: row.chatGuid,
    service: row.service,
    error: row.error ?? 0,
    ...(row.isSpam !== undefined ? { isSpam: row.isSpam } : {}),
    ...(row.special !== undefined ? { special: row.special } : {}),
    ...(row.sendEffect !== undefined ? { sendEffect: row.sendEffect } : {}),
    isAssociatedMessage: row.isTapback ?? false,
  };
}

/** An associated message (an iMessage tapback ingest could not turn into a reaction). No reader shows one. */
export function isAssociated(row: StoredMessage): boolean {
  return messageImessage(row)?.isAssociatedMessage ?? false;
}

/** Unsets a row's flat iMessage fields when a write nests them; `reactions` and `tapbackTargetGuid` stay, unread. */
export const FLAT_MESSAGE_UNSET = {
  chatGuid: undefined, service: undefined, error: undefined, isSpam: undefined, special: undefined,
  sendEffect: undefined, isTapback: undefined, tapback: undefined,
} as const;

/** A write that omits a model-text field clears it, as an edit can drop what an adapter derived before. */
export const MODEL_TEXT_UNSET = { modelText: undefined, subject: undefined, threadRef: undefined } as const;

/** A message's model-text fields that are set, to copy onto a model's view of it. */
export function modelTextFieldsOf(row: Pick<CommaMessageDoc, keyof typeof MODEL_TEXT_UNSET>): { modelText?: string; subject?: string; threadRef?: string } {
  return {
    ...(row.modelText !== undefined ? { modelText: row.modelText } : {}),
    ...(row.subject !== undefined ? { subject: row.subject } : {}),
    ...(row.threadRef !== undefined ? { threadRef: row.threadRef } : {}),
  };
}

/** A posted message in the current form. An old bridge's flat row is converted. */
export function postedMessage(input: CommaMessageInput | CommaLegacyMessageInput): CommaMessageInput {
  if ("imessage" in input) return input;
  const {
    platform: _platform, accountId: _accountId, chatGuid, service, error, isSpam, special, sendEffect, isTapback, tapback,
    tapbackTargetGuid: _target, reactions: _reactions, ...core
  } = input;
  return {
    ...core,
    imessage: {
      chatGuid, service, error, isAssociatedMessage: isTapback,
      ...(isSpam !== undefined ? { isSpam } : {}),
      ...(special !== undefined ? { special } : {}),
      ...(sendEffect !== undefined ? { sendEffect } : {}),
      ...(tapback ? { tapback } : {}),
    },
  };
}

/**
 * A message as clients read it: the side object, plus the flat fields clients built before it read. Drop the flat
 * fields once every client reads `imessage`.
 */
export function messageRead<T extends StoredMessage>(row: T): T {
  const imessage = messageImessage(row);
  if (!imessage) return row;
  const { isAssociatedMessage, ...flat } = imessage;
  return { ...row, platform: row.platform ?? "imessage", imessage, ...flat, isTapback: isAssociatedMessage };
}

/** An attachment's chat.db fields, from its side object or its flat legacy fields. */
export function attachmentImessage(row: StoredAttachment): CommaImessageAttachment | undefined {
  if (row.imessage) return row.imessage;
  if (row.isOnDisk === undefined) return undefined;
  return {
    ...(row.transferName !== undefined ? { transferName: row.transferName } : {}),
    ...(row.uti !== undefined ? { uti: row.uti } : {}),
    ...(row.transferState !== undefined ? { transferState: row.transferState } : {}),
    isSticker: row.isSticker ?? false,
    isOnDisk: row.isOnDisk,
  };
}

/** The name a person sees for an attachment. */
export function attachmentName(row: StoredAttachment): string | undefined {
  return attachmentImessage(row)?.transferName ?? row.filename;
}

/** Whether the file is on the platform's side to fetch; true where a platform has no such notion. */
export function attachmentOnDisk(row: StoredAttachment): boolean {
  return attachmentImessage(row)?.isOnDisk ?? true;
}

export const FLAT_ATTACHMENT_UNSET = {
  transferName: undefined, uti: undefined, transferState: undefined, isSticker: undefined, isOnDisk: undefined,
} as const;

export function postedAttachment(input: CommaAttachmentInput | CommaLegacyAttachmentInput): CommaAttachmentInput {
  if ("imessage" in input) return input;
  const { platform: _platform, accountId: _accountId, transferName, uti, transferState, isSticker, isOnDisk, ...core } = input;
  return {
    ...core,
    imessage: {
      ...(transferName !== undefined ? { transferName } : {}),
      ...(uti !== undefined ? { uti } : {}),
      ...(transferState !== undefined ? { transferState } : {}),
      isSticker, isOnDisk,
    },
  };
}

/** An attachment as clients read it, with the flat fields older clients read. */
export function attachmentRead<T extends StoredAttachment>(row: T): T {
  const imessage = attachmentImessage(row);
  return imessage ? { ...row, platform: row.platform ?? "imessage", imessage, ...imessage } : row;
}

/** The accounts backfill's patch for a message row, or null when it is already current. */
export function messageBackfill(row: StoredMessage & { accountId?: GenericId<"comma_accounts"> }, accountId: GenericId<"comma_accounts">) {
  const imessage = row.platform === undefined || row.platform === "imessage" ? messageImessage(row) : undefined;
  if (row.platform !== undefined && row.accountId !== undefined && (row.imessage || !imessage)) return null;
  return {
    platform: row.platform ?? "imessage" as const,
    accountId: row.accountId ?? accountId,
    ...(imessage ? { imessage, ...FLAT_MESSAGE_UNSET } : {}),
  };
}

/** The accounts backfill's patch for an attachment row, or null when it is already current. */
export function attachmentBackfill(row: StoredAttachment & { accountId?: GenericId<"comma_accounts"> }, accountId: GenericId<"comma_accounts">) {
  const imessage = attachmentImessage(row);
  if (row.platform !== undefined && row.accountId !== undefined && (row.imessage || !imessage)) return null;
  return {
    platform: row.platform ?? "imessage" as const,
    accountId: row.accountId ?? accountId,
    ...(imessage ? { imessage, ...FLAT_ATTACHMENT_UNSET } : {}),
  };
}
