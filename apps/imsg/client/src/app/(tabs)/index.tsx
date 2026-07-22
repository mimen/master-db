import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { ChatInfoContent } from "@/components/chat-info-content";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { NewChatContent } from "@/components/new-chat-content";
import { PersonContent } from "@/components/person-content";
import { SearchContent } from "@/components/search-content";
import { ThreadView } from "@/components/thread-view";
import { useChats } from "@/hooks/use-chats";
import type { JumpTarget } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { archiveChat, markChatRead, markChatUnread } from "@/lib/chat-actions";
import { patchChatFlags, patchChatWithMessage } from "@/lib/chat-store";
import { onOpenChatInfo } from "@/lib/chat-info";
import { onOpenPersonPane, type PersonTarget } from "@/lib/person-pane";
import { onSelectChat } from "@/lib/selection";
import { playReceive } from "@/lib/sounds";
import { useServerEvents } from "@/lib/sse";
import { openThreadSearch } from "@/lib/thread-search";

/** Desktop right pane: conversation details, or a contact opened over them. */
type RightPane =
  | { mode: "details"; guid: string }
  | { mode: "person"; target: PersonTarget };

const SHORTCUTS: Array<[string[], string]> = [
  [["⌘K"], "Search"],
  [["⌘N"], "New message"],
  [["⌘↓"], "Next conversation"],
  [["⌘↑"], "Previous conversation"],
  [["⌘F"], "Find in conversation"],
  [["⌘E"], "Archive / unarchive"],
  [["⌘⇧U"], "Mark read / unread"],
  [["⌘I"], "Toggle details"],
  [["Esc"], "Close panel"],
  [["⌘/"], "Shortcuts"],
];

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
  const [rightPane, setRightPane] = useState<RightPane | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
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
    return onOpenChatInfo((guid) =>
      setRightPane((cur) =>
        cur && cur.mode === "details" && cur.guid === guid ? null : { mode: "details", guid },
      ),
    );
  }, [wide]);

  // The thread header name / a detail participant opens a contact over the pane.
  useEffect(() => {
    if (!wide) return;
    return onOpenPersonPane((target) => setRightPane({ mode: "person", target }));
  }, [wide]);

  // Right pane is per-thread; close it when the selected conversation changes.
  useEffect(() => {
    setRightPane(null);
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

  // Desktop keyboard shortcuts. Browser-reserved combos (⌘N/T/W/L) can't be
  // captured by a web page; the Tauri shell will drive those through the native
  // menu (see docs/tauri-handoff.md). Everything here works in the PWA today.
  useEffect(() => {
    if (Platform.OS !== "web" || !wide) return;
    const moveSelection = (dir: 1 | -1) => {
      const idx = chats.findIndex((ch) => ch.guid === selected?.guid);
      const target = chats[Math.max(0, Math.min(chats.length - 1, idx + dir))];
      if (target) openChat(target);
    };
    const onKey = (e: KeyboardEvent) => {
      // The composer is almost always focused in a chat app, so everything is
      // ⌘-based (Esc aside) — single keys are left to typing. ⌘A/C/V/Z etc. are
      // never overridden, so text editing is untouched.
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNewChatOpen(false);
        setRightPane(null);
        setHelpOpen(false);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const toggleDetails = () => {
        if (selected)
          setRightPane((cur) =>
            cur && cur.mode === "details" && cur.guid === selected.guid
              ? null
              : { mode: "details", guid: selected.guid },
          );
      };
      switch (k) {
        case "k":
          return (e.preventDefault(), setSearchOpen(true));
        case "n":
          return (e.preventDefault(), setNewChatOpen(true));
        case "/":
          return (e.preventDefault(), setHelpOpen(true));
        case "arrowdown":
          return (e.preventDefault(), moveSelection(1));
        case "arrowup":
          return (e.preventDefault(), moveSelection(-1));
        case "f":
          if (selected) (e.preventDefault(), openThreadSearch());
          return;
        case "e":
          if (selected) (e.preventDefault(), archiveChat(selected, !selected.flags.archived));
          return;
        case "u":
          if (selected && e.shiftKey)
            (e.preventDefault(), selected.flags.unread ? markChatRead(selected) : markChatUnread(selected));
          return;
        case "i":
          return (e.preventDefault(), toggleDetails());
      }
    };
    // Capture phase: react-native-web's TextInput stops keydown from bubbling
    // while focused, so a bubble-phase document listener never sees shortcuts
    // typed in the composer. Capture fires top-down, before the input swallows it.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
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

  const cardStyle = [styles.card, { backgroundColor: theme.background, borderColor: theme.cardBorder }];

  return (
    <View style={[styles.split, { backgroundColor: theme.desk }]}>
      <View style={[styles.listCard, ...cardStyle]}>{list}</View>
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
      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={() => setHelpOpen(false)}>
        <Pressable style={styles.overlayBackdrop} onPress={() => setHelpOpen(false)}>
          <Pressable
            style={[styles.helpCard, { backgroundColor: theme.background, borderColor: theme.cardBorder }]}
            onPress={() => undefined}
          >
            <Text style={[styles.helpTitle, { color: theme.text }]}>Keyboard Shortcuts</Text>
            {SHORTCUTS.map(([keys, label]) => (
              <View key={label} style={styles.helpRow}>
                <Text style={[styles.helpLabel, { color: theme.textSecondary }]}>{label}</Text>
                <View style={styles.helpKeys}>
                  {keys.map((k) => (
                    <View
                      key={k}
                      style={[styles.kbd, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}
                    >
                      <Text style={[styles.kbdText, { color: theme.text }]}>{k}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
      <View style={[styles.threadCard, ...cardStyle]}>
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
      {rightPane && (
        <View style={[styles.infoCard, ...cardStyle]}>
          {rightPane.mode === "details" ? (
            <ChatInfoContent
              key={rightPane.guid}
              guid={rightPane.guid}
              showHeader
              onClose={() => setRightPane(null)}
              onOpenPerson={(address, name) =>
                setRightPane({ mode: "person", target: { address, name, backGuid: rightPane.guid } })
              }
              onDeleted={() => {
                setRightPane(null);
                setSelected(null);
                refresh();
              }}
            />
          ) : (
            <PersonContent
              key={rightPane.target.address}
              address={rightPane.target.address}
              name={rightPane.target.name}
              showHeader
              backLabel="Details"
              onBack={() => setRightPane({ mode: "details", guid: rightPane.target.backGuid })}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  // Floating "3D" panels: elevated ground, rounded, top-lit border + drop shadow.
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
  },
  listCard: {
    flexBasis: 380,
    flexGrow: 0,
    flexShrink: 0,
    width: 380,
  },
  threadCard: {
    flex: 1,
  },
  infoCard: {
    flexBasis: 330,
    flexGrow: 0,
    flexShrink: 0,
    width: 330,
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
  helpCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "90%",
    paddingHorizontal: 22,
    paddingVertical: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    width: 360,
  },
  helpTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 14,
  },
  helpRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 32,
  },
  helpLabel: {
    fontSize: 14,
  },
  helpKeys: {
    flexDirection: "row",
    gap: 5,
  },
  kbd: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  kbdText: {
    fontSize: 12,
    fontWeight: "600",
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
