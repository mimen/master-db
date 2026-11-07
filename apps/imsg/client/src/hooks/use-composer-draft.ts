import { useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useEffect, useRef } from "react";
import type { ConversationId } from "@shared/types";
import { commaApi, commaDraftsApi } from "@/lib/convex-api";
import { useConvexAuth } from "@/lib/convex-auth";
import { createDraftSync } from "@/lib/draft-sync";
import { getDraft, setDraft, subscribeDrafts } from "@/lib/drafts";
import { convexClient } from "@/lib/identity";
import { showToast } from "@/lib/toast";

export function useComposerDraft(conversationId: ConversationId, editing: boolean, onRemote: (text: string) => void) {
  const { isAuthenticated: enabled } = useConvexAuth();
  const remote = useQuery(commaApi.getDraft, enabled ? { conversationId } : "skip");
  const sync = useRef<ReturnType<typeof createDraftSync> | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const session = createDraftSync({
      text: getDraft(conversationId),
      write: async (text) => {
        await convexClient.mutation(commaDraftsApi.setDraft, { conversationId, text });
      },
      onRemote: (text) => {
        setDraft(conversationId, text, "remote");
        onRemote(text);
      },
      onError: () => showToast("Draft kept on this device. Cloud sync failed."),
    });
    sync.current = session;
    if (focused.current) session.focus();
    const unsubscribe = subscribeDrafts((id, text) => {
      if (id === conversationId) session.save(text);
    });
    return () => {
      unsubscribe();
      void session.flush();
      sync.current = null;
    };
  }, [conversationId, enabled, onRemote]);

  useEffect(() => {
    if (enabled && !editing && remote !== undefined) sync.current?.receive(remote);
  }, [conversationId, enabled, editing, remote]);

  return {
    /** The conversation's stored draft, for its note and attachments. The text flows through onRemote. */
    draft: remote && remote.conversationId === conversationId ? remote : null,
    removeAttachment: (storageId: GenericId<"_storage">) => {
      void convexClient.mutation(commaDraftsApi.removeDraftAttachment, { conversationId, storageId })
        .catch(() => showToast("Couldn't remove the drafted attachment."));
    },
    onFocus: () => { focused.current = true; sync.current?.focus(); },
    onBlur: () => { focused.current = false; void sync.current?.blur(); },
  };
}
