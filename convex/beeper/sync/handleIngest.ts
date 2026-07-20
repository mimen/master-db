import { internal } from "../../_generated/api";
import { httpAction } from "../../_generated/server";

import { checkBeeperIngestAuth, jsonResponse } from "./auth";

/**
 * Ingest endpoint for the Beeper local sync script.
 *
 * Path:    POST /beeper/ingest
 * Headers: Authorization: Bearer <BEEPER_INGEST_SECRET>
 *
 * Body (any combination):
 *   {
 *     "accounts"?: BeeperAccount[],
 *     "chats"?: BeeperChat[],
 *     "messages_by_chat"?: { chat_id: string, messages: BeeperMessage[] }[],
 *     "mark_synced"?: { account_id: string, sync_type: "full" | "incremental" }
 *   }
 *
 * The endpoint is intentionally batch-shaped: the script collects a few
 * thousand rows per request rather than one row per HTTP call. Messages are
 * grouped by chat because upsertMessages enforces per-chat batching.
 *
 * Response: { ok: true, counts: { accounts, chats, messages } }
 */
export const handleIngest = httpAction(async (ctx, req) => {
  const authErr = checkBeeperIngestAuth(req);
  if (authErr) return authErr;

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
  }

  const counts = { accounts: 0, chats: 0, messages: 0 };

  if (body.accounts) {
    for (const account of body.accounts) {
      await ctx.runMutation(
        internal.beeper.internalMutations.upsertAccount.upsertAccount,
        {
          account,
          mark_full_sync_started: body.mark_full_sync_started ?? false,
        },
      );
      counts.accounts += 1;
    }
  }

  if (body.chats) {
    for (const chat of body.chats) {
      await ctx.runMutation(
        internal.beeper.internalMutations.upsertChat.upsertChat,
        { chat },
      );
      counts.chats += 1;
    }
  }

  if (body.messages_by_chat) {
    for (const group of body.messages_by_chat) {
      const result = await ctx.runMutation(
        internal.beeper.internalMutations.upsertMessages.upsertMessages,
        { chat_id: group.chat_id, messages: group.messages },
      );
      counts.messages += result.inserted + result.updated;
    }
  }

  if (body.mark_synced) {
    await ctx.runMutation(
      internal.beeper.internalMutations.markAccountSynced.markAccountSynced,
      body.mark_synced,
    );
  }

  return jsonResponse({ ok: true, counts });
});

// Loose types for the ingest payload. The strict per-row validators live in
// the internal mutations themselves; this handler is intentionally permissive
// so a bad row gets a typed runtime error from Convex, not a 400 here.
type IngestBody = {
  accounts?: BeeperAccountIn[];
  chats?: BeeperChatIn[];
  messages_by_chat?: { chat_id: string; messages: BeeperMessageIn[] }[];
  mark_full_sync_started?: boolean;
  mark_synced?: { account_id: string; sync_type: "full" | "incremental" };
};

// These mirror the validators in types/ingestApi.ts but as plain TS types so
// the handler compiles without re-exporting Infer<> values.
type BeeperAccountIn = {
  account_id: string;
  network: string;
  display_name?: string;
  phone_number?: string;
  is_active?: boolean;
  raw?: string;
};

type Participant = {
  id: string;
  phone_number?: string;
  full_name?: string;
  is_self?: boolean;
  is_admin?: boolean;
  img_url?: string;
};

type BeeperChatIn = {
  account_id: string;
  network: string;
  chat_id: string;
  local_chat_id?: string;
  title?: string;
  description?: string;
  type: string;
  img_url?: string;
  participants: Participant[];
  last_activity?: string;
  is_archived?: boolean;
  is_muted?: boolean;
  is_pinned?: boolean;
  is_read_only?: boolean;
  unread_count?: number;
  raw?: string;
};

type Reaction = { participant_id: string; emoji_or_key: string };

type AttachmentIn = {
  mxc_id: string;
  type?: string;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  is_gif?: boolean;
  is_sticker?: boolean;
  beeper_src_url?: string;
  convex_storage_id?: string;
};

type BeeperMessageIn = {
  account_id: string;
  network: string;
  chat_id: string;
  message_id: string;
  sort_key?: string;
  sender_id?: string;
  sender_name?: string;
  is_sender?: boolean;
  timestamp?: string;
  type?: string;
  text?: string;
  reactions?: Reaction[];
  attachments?: AttachmentIn[];
  reply_to_message_id?: string;
  is_deleted?: boolean;
  is_hidden?: boolean;
  raw?: string;
};
