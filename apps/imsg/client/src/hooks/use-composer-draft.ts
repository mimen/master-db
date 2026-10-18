import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useEffect, useRef } from "react";
import { commaApi, commaDraftsApi } from "@/lib/convex-api";
import { useConversationRef } from "@/hooks/use-chat-directory";
import { useConvexAuth } from "@/lib/convex-auth";
import { createDraftSync } from "@/lib/draft-sync";
import { getDraft, setDraft, subscribeDrafts, uploadLocalDrafts } from "@/lib/drafts";
import { convexClient } from "@/lib/identity";
import { showToast } from "@/lib/toast";

export function useComposerDraft(chatGuid: string, editing: boolean, onRemote: (text: string) => void) {
  const { isAuthenticated } = useConvexAuth();
  const enabled = isAuthenticated;
  const { conversationId } = useConversationRef(enabled ? chatGuid : null);
  const remote = useQuery(commaApi.getDraft, conversationId ? { conversationId } : "skip");
  const sync = useRef<ReturnType<typeof createDraftSync> | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const session = createDraftSync({
      text: getDraft(chatGuid),
      write: async (text) => {
        const resolved = await convexClient.query(commaApi.resolveChat, { chatGuid });
        if (!resolved) throw new Error("Conversation is not mirrored yet");
        await convexClient.mutation(commaDraftsApi.setDraft, { conversationId: resolved._id, text });
      },
      onRemote: (text) => {
        setDraft(chatGuid, text, "remote");
        onRemote(text);
      },
      onError: () => showToast("Draft kept on this device. Cloud sync failed."),
    });
    sync.current = session;
    if (focused.current) session.focus();
    const unsubscribe = subscribeDrafts((guid, text) => {
      if (guid === chatGuid) session.save(text);
    });
    return () => {
      unsubscribe();
      void session.flush();
      sync.current = null;
    };
  }, [chatGuid, enabled, onRemote]);

  useEffect(() => {
    if (enabled && !editing && remote !== undefined) sync.current?.receive(remote);
  }, [chatGuid, enabled, editing, remote]);

  useEffect(() => {
    if (!enabled) return;
    void uploadLocalDrafts(async (guid, text) => {
      const resolved = await convexClient.query(commaApi.resolveChat, { chatGuid: guid });
      if (!resolved) return;
      const existing = await convexClient.query(commaApi.getDraft, { conversationId: resolved._id });
      // Local drafts predate timestamps. Keep an existing cloud draft and any newer local edit.
      if (!existing && getDraft(guid) === text) {
        await convexClient.mutation(commaDraftsApi.setDraft, { conversationId: resolved._id, text });
      }
    }).catch(() => showToast("Local drafts kept. Cloud import will retry when a chat opens."));
  }, [chatGuid, enabled]);

  return {
    /** The conversation's stored draft, for its note and attachments. The text flows through onRemote. */
    draft: remote && remote.conversationId === conversationId ? remote : null,
    removeAttachment: (storageId: GenericId<"_storage">) => {
      if (conversationId) void convexClient.mutation(commaDraftsApi.removeDraftAttachment, { conversationId, storageId })
        .catch(() => showToast("Couldn't remove the drafted attachment."));
    },
    onFocus: () => { focused.current = true; sync.current?.focus(); },
    onBlur: () => { focused.current = false; void sync.current?.blur(); },
  };
}
