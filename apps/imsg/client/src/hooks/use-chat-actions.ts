import { router } from "expo-router";
import type { ChatSummary } from "@shared/types";

import { type PopoverAnchor, useActionSheet } from "@/lib/action-sheet";
import { markChatRead, markChatUnread, pinChat } from "@/lib/chat-actions";
import { openChatInfo } from "@/lib/chat-info";
import { openDeferMenu, skipToday } from "@/lib/later";
import { canFollowUp } from "@/lib/later-times";
import { copyHandleAction } from "@/lib/copy-handle";
import { shortcutFor } from "@/lib/keyboard/registry";

interface ChatActions {
  openMenu: (chat: ChatSummary, anchor?: PopoverAnchor) => void;
}

/**
 * Shared conversation menu — used by rows and inside a
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
      ...(chat.later?.snoozedUntil === undefined ? [{ label: "Skip today", icon: "arrow-forward-outline" as const, shortcut: shortcutFor("conversation.skipToday"), onPress: () => skipToday(chat) }] : []),
      { label: chat.later?.snoozedUntil !== undefined ? "Snoozed…" : "Later…", icon: "time-outline" as const, shortcut: shortcutFor("conversation.later"),
        onPress: () => openDeferMenu(showSheet, chat, "later", { anchor }) },
      ...(canFollowUp(chat) ? [{ label: "Follow up…", icon: "alarm-outline" as const, onPress: () => openDeferMenu(showSheet, chat, "followUp", { anchor }) }] : []),
      ...(!chat.isGroup && chat.participants[0] ? [copyHandleAction(chat.participants[0].address)] : []),
      {
        label: "Details",
        onPress: () => {
          if (detailsInPane) openChatInfo(chat.conversationId);
          else router.push({ pathname: "/chat-info", params: { conversation: chat.conversationId } });
        },
      },
    ];
    showSheet({ title: chat.displayName, actions, anchor });
  };
  return { openMenu };
}
