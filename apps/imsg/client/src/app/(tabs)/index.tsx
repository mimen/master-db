import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { ChatInfoContent } from "@/components/chat-info-content";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { NewChatContent } from "@/components/new-chat-content";
import { SearchContent } from "@/components/search-content";
import { ThreadView } from "@/components/thread-view";
import { useChats } from "@/hooks/use-chats";
import type { JumpTarget } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { patchChatFlags, patchChatWithMessage } from "@/lib/chat-store";
import { onOpenChatInfo } from "@/lib/chat-info";
import { onSelectChat } from "@/lib/selection";
import { playReceive } from "@/lib/sounds";
import { useServerEvents } from "@/lib/sse";

export default function ChatListScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [state, setState] = useState<StateFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [infoGuid, setInfoGuid] = useState<string | null>(null);
  const { chats, counts, loading, refresh } = useChats(state, type);

  const reconcile = useRef<ReturnType<typeof setTimeout> | null>(null);
  useServerEvents(
    useCallback(
      (event) => {
        if (event.kind === "new-message") {
          if (!event.message.isFromMe) playReceive();
          // New messages are safe to patch immediately. Updates can remove
          // unread eligibility, so the delayed refresh reconciles those.
          patchChatWithMessage(event.chatGuid, event.message);
        }
        if (reconcile.current) clearTimeout(reconcile.current);
        reconcile.current = setTimeout(() => refresh(), 1200);
      },
      [refresh],
    ),
  );

  // Wide-mode overlays (and the Contacts tab's "message them" action)
  // publish chats to open here instead of navigating.
  useEffect(() => {
    if (!wide) return;
    return onSelectChat((selection) => {
      const known = chats.find((chat) => chat.guid === selection.guid);
      setJumpTarget(selection.jumpTarget ?? null);
      setSelected(
        known ?? {
          guid: selection.guid,
          displayName: selection.name ?? selection.guid,
          isGroup: selection.isGroup ?? selection.guid.includes(";+;"),
          known: true,
          isSpam: false,
          participants: [],
          lastMessage: null,
          unreadCount: 0,
          flags: {
            archived: false,
            unresponded: false,
            waiting: false,
            unread: false,
            mutedUnresponded: false,
            pinned: false,
          },
        },
      );
    });
  }, [wide, chats]);

  // The thread-pane info button opens details as a right-hand pane here (a
  // second press on the same chat toggles it closed).
  useEffect(() => {
    if (!wide) return;
    return onOpenChatInfo((guid) => setInfoGuid((cur) => (cur === guid ? null : guid)));
  }, [wide]);

  // Details pane is per-thread; close it when the selected conversation changes.
  useEffect(() => {
    setInfoGuid(null);
  }, [selected?.guid]);

  // Keep the selected chat's flags fresh as the directory reconciles.
  useEffect(() => {
    if (!selected) return;
    const updated = chats.find((chat) => chat.guid === selected.guid);
    if (updated && updated !== selected) setSelected(updated);
  }, [chats, selected]);

  const openChat = (chat: ChatSummary): void => {
    if (chat.flags.unread) patchChatFlags(chat.guid, { unread: false, unreadCount: 0 });
    if (wide) {
      setJumpTarget(null);
      setSelected(chat);
      return;
    }
    router.push({
      pathname: "/chat/[guid]",
      params: {
        guid: chat.guid,
        name: chat.displayName,
        isGroup: chat.isGroup ? "1" : "0",
        count: String(chat.participants.length),
      },
    });
  };

  const openNewMessage = (): void => {
    if (wide) setNewChatOpen(true);
    else router.push("/new-chat");
  };

  // Desktop keyboard shortcuts: ⌘K search, ⌘N new, ↑/↓ chat nav, Esc closes panes.
  useEffect(() => {
    if (Platform.OS !== "web" || !wide) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewChatOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setNewChatOpen(false);
        setInfoGuid(null);
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !searchOpen && !newChatOpen) {
        const active = document.activeElement;
        const inField =
          active instanceof HTMLElement &&
          (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
        if (inField) return;
        e.preventDefault();
        const idx = chats.findIndex((ch) => ch.guid === selected?.guid);
        const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
        const target = chats[Math.max(0, Math.min(chats.length - 1, next))];
        if (target) openChat(target);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, chats, selected, searchOpen, newChatOpen]);

  const list = (
    <ConversationListPane
      chats={chats}
      counts={counts}
      filters={{ state, type }}
      loading={loading}
      wide={wide}
      selectedGuid={wide ? selected?.guid : undefined}
      onFiltersChange={(filters) => {
        setState(filters.state);
        setType(filters.type);
      }}
      onOpenChat={openChat}
      onRefresh={refresh}
      onNewMessage={openNewMessage}
    />
  );

  if (!wide) {
    return <View style={{ flex: 1, backgroundColor: theme.background }}>{list}</View>;
  }

  return (
    <View style={[styles.split, { backgroundColor: theme.background }]}>
      {list}
      <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={() => setSearchOpen(false)}>
        <Pressable style={styles.overlayBackdrop} onPress={() => setSearchOpen(false)}>
          <Pressable style={[styles.overlayPanel, { backgroundColor: theme.background }]} onPress={() => undefined}>
            <SearchContent initialQuery={searchQuery} onClose={() => setSearchOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={newChatOpen} transparent animationType="fade" onRequestClose={() => setNewChatOpen(false)}>
        <Pressable style={styles.overlayBackdrop} onPress={() => setNewChatOpen(false)}>
          <Pressable style={[styles.overlayPanel, { backgroundColor: theme.background }]} onPress={() => undefined}>
            <NewChatContent onClose={() => setNewChatOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <View style={styles.threadPane}>
        {selected ? (
          <ThreadView
            key={selected.guid + (jumpTarget?.guid ?? "")}
            chatGuid={selected.guid}
            isGroup={selected.isGroup}
            jumpTarget={jumpTarget}
            headerChat={selected}
          />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="chatbubble-ellipses-outline" size={28} color={theme.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Select a conversation</Text>
          </View>
        )}
      </View>
      {infoGuid && (
        <View style={[styles.infoPane, { borderLeftColor: theme.divider }]}>
          <ChatInfoContent
            key={infoGuid}
            guid={infoGuid}
            showHeader
            onClose={() => setInfoGuid(null)}
            onDeleted={() => {
              setInfoGuid(null);
              setSelected(null);
              refresh();
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: "row",
  },
  threadPane: {
    flex: 1,
  },
  infoPane: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    width: 340,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: 9,
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 15,
  },
  overlayBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    flex: 1,
    paddingTop: 90,
  },
  overlayPanel: {
    borderRadius: 16,
    height: 560,
    maxHeight: "75%",
    maxWidth: "90%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    width: 600,
  },
});
