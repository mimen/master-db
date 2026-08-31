import { router } from "expo-router";
import { Platform } from "react-native";
import type { ChatSummary } from "@shared/types";

import { type PopoverAnchor, useActionSheet } from "@/lib/action-sheet";
import {
  archiveChat,
  markChatRead,
  markChatUnread,
  pinChat,
} from "@/lib/chat-actions";
import { openChatInfo } from "@/lib/chat-info";
import { nestedSheetDelay } from "@/lib/nested-sheet";
import { showToast } from "@/lib/toast";
import { laterOptions, setTriageLater } from "@/hooks/use-triage-actions";

interface ChatActions {
  openMenu: (chat: ChatSummary, anchor?: PopoverAnchor) => void;
}

/**
 * Shared conversation menu — used by rows, the priority shelf, and inside a
 * chat. Queue resolution stays contextual; this menu contains only durable
 * conversation actions plus Later for an active triage item.
 */
export function useChatActions(detailsInPane: boolean): ChatActions {
  const showSheet = useActionSheet();
  const openMenu = (chat: ChatSummary, anchor?: PopoverAnchor): void => {
    const openLater = (): void => {
      showSheet({
        title: `Later · ${chat.displayName}`,
        anchor,
        actions: laterOptions().map((option) => ({
          label: option.label,
          onPress: () => {
            void setTriageLater(chat, option.until).catch(() => showToast("Could not move conversation to Later"));
          },
        })),
      });
    };
    const presentLater = (): void => {
      const delay = nestedSheetDelay(Platform.OS);
      if (delay > 0) setTimeout(openLater, delay);
      else openLater();
    };
    const actions = [
      chat.flags.unread
        ? { label: "Mark as read", onPress: () => markChatRead(chat) }
        : { label: "Mark as unread", onPress: () => markChatUnread(chat) },
      chat.flags.pinned
        ? { label: "Unpin", onPress: () => pinChat(chat, false) }
        : { label: "Pin", onPress: () => pinChat(chat, true) },
      ...(chat.flags.unresponded || chat.flags.waiting
        ? [{ label: "Later…", onPress: presentLater }]
        : []),
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
