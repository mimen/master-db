import type { ChatSummary } from "@shared/types";

import { useActionSheet } from "@/lib/action-sheet";
import {
  archiveChat,
  dismissChat,
  markChatRead,
  markChatUnread,
  muteChat,
  pinChat,
} from "@/lib/chat-actions";

interface ChatActions {
  openMenu: (chat: ChatSummary) => void;
}

/**
 * Shared conversation menu — used by rows, the priority shelf, and inside a
 * chat. All mutations go through the optimistic chat-actions layer so every
 * surface updates instantly.
 */
export function useChatActions(): ChatActions {
  const showSheet = useActionSheet();
  const openMenu = (chat: ChatSummary): void => {
    const actions = [
      chat.flags.unread
        ? { label: "Mark as read", onPress: () => markChatRead(chat) }
        : { label: "Mark as unread", onPress: () => markChatUnread(chat) },
      ...(chat.flags.unresponded
        ? [{ label: "No reply needed", onPress: () => dismissChat(chat, "unresponded") }]
        : []),
      ...(chat.flags.waiting
        ? [{ label: "Not waiting on this", onPress: () => dismissChat(chat, "waiting") }]
        : []),
      chat.flags.pinned
        ? { label: "Unpin", onPress: () => pinChat(chat, false) }
        : { label: "Pin", onPress: () => pinChat(chat, true) },
      chat.flags.archived
        ? { label: "Unarchive", onPress: () => archiveChat(chat, false) }
        : { label: "Archive", destructive: true, onPress: () => archiveChat(chat, true) },
      ...(chat.isGroup
        ? [
            {
              label: chat.flags.mutedUnresponded ? "Show in Unresponded" : "Hide from Unresponded",
              onPress: () => muteChat(chat, !chat.flags.mutedUnresponded),
            },
          ]
        : []),
    ];
    showSheet({ title: chat.displayName, actions });
  };
  return { openMenu };
}
