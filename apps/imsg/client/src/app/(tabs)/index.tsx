import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { ChatInfoContent } from "@/components/chat-info-content";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { EmptyState } from "@/components/empty-state";
import { OverlayShell } from "@/components/overlay-shell";
import { PersonContent } from "@/components/person-content";
import { CommandPalette } from "@/components/command-palette";
import { ThreadView } from "@/components/thread-view";
import { ShadowPanel } from "@/components/shadow-panel";
import { useAiStatus } from "@/hooks/use-ai";
import { useChats } from "@/hooks/use-chats";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import type { JumpTarget } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { CardShadow, Radii, Type } from "@/constants/theme";
import { archiveChat, markChatUnread, undoLastAction } from "@/lib/chat-actions";
import { patchChatFlags, patchChatWithMessage } from "@/lib/chat-store";
import {
  getListAdapter,
  isListMode,
  requestFocus,
  setKeyboardRuntime,
  setListMode,
} from "@/lib/keyboard/controller";
import { installKeyboardDispatcher } from "@/lib/keyboard/dispatcher";
import { helpEntries } from "@/lib/keyboard/registry";
import { onOpenChatInfo } from "@/lib/chat-info";
import { onOpenPersonPane, type PersonTarget } from "@/lib/person-pane";
import { onSelectChat } from "@/lib/selection";
import { playReceive } from "@/lib/sounds";
import { useServerEvents } from "@/lib/sse";
import { openThreadSearch } from "@/lib/thread-search";
import { showToast } from "@/lib/toast";

/** Desktop right pane: conversation details, or a contact opened over them. */
type RightPane =
  | { mode: "details"; guid: string }
  | { mode: "person"; target: PersonTarget };

/** Rendered from the keyboard registry — cannot drift from actual bindings. */
const HELP_ENTRIES = helpEntries();

export default function ChatListScreen() {
  const theme = useTheme();
  const { wide, canShadow: canShadowLayout } = useLayoutMode();
  const aiStatus = useAiStatus();
  // The shadow panel needs room beyond the list+thread; keep it to wide desktops.
  const canShadow = canShadowLayout && aiStatus?.shadow === true;
  const [shadowOpen, setShadowOpen] = useState(false);
  // Unresponded is the working view — the inbox opens on what needs a reply.
  const [state, setState] = useState<StateFilter>("unresponded");
  const [type, setType] = useState<TypeFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  // ⌘N / compose button open the palette straight into its compose mode.
  const [paletteCompose, setPaletteCompose] = useState(false);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  // "reply" focuses the composer and marks read; "preview" (glide j/k) does neither.
  const [selectionIntent, setSelectionIntent] = useState<"reply" | "preview">("reply");
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [rightPane, setRightPane] = useState<RightPane | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { chats, allChats, counts, loading, refresh } = useChats(state, type);

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
      setSelectionIntent("reply");
      setSelected(chat);
      setListMode(false);
      requestFocus("composer");
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

  /** Glide-mode j/k: show the thread, keep list focus, don't mark read. */
  const previewChat = (chat: ChatSummary): void => {
    setJumpTarget(null);
    setSelectionIntent("preview");
    setSelected(chat);
  };

  const openNewMessage = (): void => {
    if (wide) {
      setPaletteCompose(true);
      setSearchOpen(true);
    } else {
      router.push("/new-chat");
    }
  };

  // Keyboard system (docs/keyboard-design.md, Slice 2): compose-first with an
  // Esc-entered glide mode. This screen registers the runtime (over refs so
  // dispatch acts on current state); list navigation delegates to the pane's
  // adapter so keyboard order follows the rendered order.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const overlaysRef = useRef({ helpOpen, searchOpen, rightPane });
  overlaysRef.current = { helpOpen, searchOpen, rightPane };
  useEffect(() => {
    if (Platform.OS !== "web" || !wide) return;
    setKeyboardRuntime({
      openPalette: () => {
        setPaletteCompose(false);
        setSearchOpen(true);
      },
      openNewMessage: () => {
        setPaletteCompose(true);
        setSearchOpen(true);
      },
      openHelp: () => setHelpOpen(true),
      moveSelection: (delta) => {
        setListMode(true);
        getListAdapter()?.move(delta);
      },
      activateSelection: () => getListAdapter()?.activate(),
      findInConversation: () => {
        if (selectedRef.current) openThreadSearch();
      },
      archiveSelected: () => {
        const sel = selectedRef.current;
        if (!sel) return;
        const archived = !sel.flags.archived;
        archiveChat(sel, archived);
        showToast(archived ? "Archived — Z to undo" : "Unarchived — Z to undo");
        // The row leaves the current view — glide onto its neighbor so the
        // cursor never dangles on a vanished conversation.
        getListAdapter()?.selectNeighborOf(sel.guid);
      },
      markUnreadSelected: () => {
        const sel = selectedRef.current;
        if (!sel) return;
        markChatUnread(sel);
        showToast("Marked unread — Z to undo");
      },
      toggleDetails: () => {
        const sel = selectedRef.current;
        if (!sel) return;
        setRightPane((cur) =>
          cur && cur.mode === "details" && cur.guid === sel.guid
            ? null
            : { mode: "details", guid: sel.guid },
        );
      },
      focusListSearch: () => getListAdapter()?.focusSearch(),
      undoLast: () => showToast(undoLastAction() ? "Undone" : "Nothing to undo"),
      // Esc precedence ladder — first applicable step only.
      escape: () => {
        const o = overlaysRef.current;
        if (o.helpOpen) return setHelpOpen(false);
        if (o.searchOpen) return setSearchOpen(false);
        // An active list search clears before anything else closes.
        if (getListAdapter()?.clearSearch()) return;
        if (!isListMode()) {
          // From the composer (or anywhere non-glide): enter glide mode.
          const active = document.activeElement;
          if (active instanceof HTMLElement) active.blur();
          setListMode(true);
          return;
        }
        if (o.rightPane) return setRightPane(null);
        // Already gliding with nothing to close — stay.
      },
    });
    const uninstall = installKeyboardDispatcher();
    return () => {
      uninstall();
      setKeyboardRuntime(null);
      setListMode(false);
    };
  }, [wide]);

  const list = (
    <ConversationListPane
      chats={chats}
      allChats={allChats}
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
      onPreviewChat={previewChat}
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
      <OverlayShell
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        backdropStyle={styles.overlayBackdrop}
        cardStyle={styles.overlayPanel}
      >
        <CommandPalette
          key={paletteCompose ? "compose" : "root"}
          chats={allChats}
          initialMode={paletteCompose ? "compose" : "root"}
          onClose={() => setSearchOpen(false)}
          onOpenChat={openChat}
          // Lens application follows badge semantics: exit search first,
          // then apply the picked dimension.
          onApplyState={(value) => {
            getListAdapter()?.clearSearch();
            setState(value);
          }}
          onApplyType={(value) => {
            getListAdapter()?.clearSearch();
            setType(value);
          }}
          onShowHelp={() => setHelpOpen(true)}
        />
      </OverlayShell>
      <OverlayShell
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        backdropStyle={styles.overlayBackdrop}
        cardStyle={[styles.helpCard, { borderColor: theme.cardBorder }]}
      >
        <Text style={[styles.helpTitle, { color: theme.text }]}>Keyboard Shortcuts</Text>
        {HELP_ENTRIES.map(({ title, keys }) => (
          <View key={title} style={styles.helpRow}>
            <Text style={[styles.helpLabel, { color: theme.textSecondary }]}>{title}</Text>
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
      </OverlayShell>
      <View style={[styles.threadCard, ...cardStyle]}>
        {selected ? (
          <ThreadView
            key={selected.guid + (jumpTarget?.guid ?? "")}
            chatGuid={selected.guid}
            isGroup={selected.isGroup}
            jumpTarget={jumpTarget}
            headerChat={selected}
            previewOnly={selectionIntent === "preview"}
            onToggleShadow={canShadow ? () => setShadowOpen((v) => !v) : undefined}
            shadowOpen={shadowOpen}
          />
        ) : (
          <EmptyState icon="chatbubble-ellipses-outline" message="Select a conversation" />
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
              // Palette-opened cards have no originating conversation to go
              // back to; the header just offers close in that case.
              backLabel={rightPane.target.backGuid ? "Details" : undefined}
              onBack={
                rightPane.target.backGuid
                  ? () => setRightPane({ mode: "details", guid: rightPane.target.backGuid })
                  : undefined
              }
            />
          )}
        </View>
      )}
      {canShadow && shadowOpen && selected && (
        <View style={[styles.infoCard, ...cardStyle]}>
          <ShadowPanel key={selected.guid} chatGuid={selected.guid} onClose={() => setShadowOpen(false)} />
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
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    // Top-lit edge highlight, not a theme color — same effect works on both
    // schemes' dark "desk" backdrop.
    borderTopColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    ...CardShadow,
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
  // Not fully centered — offset from the top, matching the original inline
  // Modal backdrops this shell replaced.
  overlayBackdrop: {
    justifyContent: "flex-start",
    paddingTop: 90,
  },
  helpCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "90%",
    paddingHorizontal: 22,
    paddingVertical: 20,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    width: 360,
  },
  helpTitle: {
    fontSize: Type.title,
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
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    width: 600,
  },
});
