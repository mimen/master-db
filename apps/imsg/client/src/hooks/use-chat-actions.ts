import { router } from "expo-router";
import type { ChatSummary } from "@shared/types";

import { type PopoverAnchor, useActionSheet } from "@/lib/action-sheet";
import {
  archiveChat,
  markChatRead,
  markChatUnread,
  pinChat,
} from "@/lib/chat-actions";
import { openChatInfo } from "@/lib/chat-info";

interface ChatActions {
  openMenu: (chat: ChatSummary, anchor?: PopoverAnchor) => void;
}

/**
 * Shared conversation menu — used by rows, the priority shelf, and inside a
 * chat. Queue resolution stays contextual; this menu contains only durable
 * conversation actions.
 */
export function useChatActions(detailsInPane: boolean): ChatActions {
  const showSheet = useActionSheet();
  const openMenu = (chat: ChatSummary, anchor?: PopoverAnchor): void => {
    const actions = [
      chat.flags.unread
        ? { label: "Mark as read", onPress: () => markChatRead(chat) }
        : { label: "Mark as unread", onPress: () => markChatUnread(chat) },
      chat.flags.pinned
        ? { label: "Unpin", onPress: () => pinChat(chat, false) }
        : { label: "Pin", onPress: () => pinChat(chat, true) },
      chat.flags.archived
        ? { label: "Unarchive", onPress: () => archiveChat(chat, false) }
        : { label: "Archive", destructive: true, onPress: () => archiveChat(chat, true) },
      {
        label: "Details",
        onPress: () => {
          if (detailsInPane) openChatInfo(chat.guid);
          else router.push({ pathname: "/chat-info", params: { guid: chat.guid } });
        },
      },
    ];
    showSheet({ title: chat.displayName, actions, anchor });
  };
  return { openMenu };
}
