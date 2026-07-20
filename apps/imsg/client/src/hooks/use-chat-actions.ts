import type { ChatSummary } from "@shared/types";

import { useActionSheet } from "@/lib/action-sheet";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";

interface ChatActions {
  run: (action: Promise<unknown>) => void;
  openMenu: (chat: ChatSummary) => void;
}

/** Shared row/shelf actions so Priority conversations retain their context menu. */
export function useChatActions(onChanged: () => void): ChatActions {
  const showSheet = useActionSheet();
  const run = (action: Promise<unknown>): void => {
    void action.then(onChanged).catch(() => {
      showToast("Action failed");
      onChanged();
    });
  };
  const openMenu = (chat: ChatSummary): void => {
    const actions = [
      chat.flags.unread
        ? { label: "Mark as read", onPress: () => run(api.markRead(chat.guid)) }
        : { label: "Mark as unread", onPress: () => run(api.markUnread(chat.guid)) },
      ...(chat.flags.unresponded
        ? [{ label: "No reply needed", onPress: () => run(api.dismiss(chat.guid, "unresponded")) }]
        : []),
      ...(chat.flags.waiting
        ? [{ label: "Not waiting on this", onPress: () => run(api.dismiss(chat.guid, "waiting")) }]
        : []),
      chat.flags.pinned
        ? { label: "Unpin", onPress: () => run(api.setPinned(chat.guid, false)) }
        : { label: "Pin", onPress: () => run(api.setPinned(chat.guid, true)) },
      chat.flags.archived
        ? { label: "Unarchive", onPress: () => run(api.setArchived(chat.guid, false)) }
        : { label: "Archive", destructive: true, onPress: () => run(api.setArchived(chat.guid, true)) },
      ...(chat.isGroup
        ? [
            {
              label: chat.flags.mutedUnresponded ? "Show in Unresponded" : "Hide from Unresponded",
              onPress: () => run(api.setMuted(chat.guid, !chat.flags.mutedUnresponded)),
            },
          ]
        : []),
    ];
    showSheet({ title: chat.displayName, actions });
  };
  return { run, openMenu };
}
