import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { ChatInfoContent } from "@/components/chat-info-content";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { EmptyState } from "@/components/empty-state";
import { OverlayShell } from "@/components/overlay-shell";
import { PersonContent } from "@/components/person-content";
import { ScheduledContent } from "@/components/scheduled-content";
import { SettingsContent } from "@/components/settings-content";
import { CommandPalette } from "@/components/command-palette";
import { ThreadView } from "@/components/thread-view";
import { ShadowPanel } from "@/components/shadow-panel";
import { SweepOverlay } from "@/components/sweep-overlay";
import { useAiStatus } from "@/hooks/use-ai";
import { useChats } from "@/hooks/use-chats";
import { finishTriageChat, laterOptions, setTriageLater, undoLastTriageAction } from "@/hooks/use-triage-actions";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import type { JumpTarget } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { Type } from "@/constants/theme";
import { markChatUnread, undoLastAction } from "@/lib/chat-actions";
import { DesktopAuxPane, DesktopSplit } from "@/components/desktop-split";
import { installNativeMenuBridge } from "@/lib/desktop-shell";
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
import { onRequestInboxFilter } from "@/lib/inbox-filter";
import { onOpenPersonPane, type PersonTarget } from "@/lib/person-pane";
import { onOpenScheduledPane } from "@/lib/scheduled-pane";
import { onOpenSettingsPane } from "@/lib/settings-pane";
import { onSelectChat } from "@/lib/selection";
import { playReceive } from "@/lib/sounds";
import { useServerEvents } from "@/lib/sse";
import { openThreadSearch } from "@/lib/thread-search";
import { showToast } from "@/lib/toast";
import { useActionSheet } from "@/lib/action-sheet";

/** Desktop right pane: conversation details, a contact opened over them, or a
 * standalone surface (scheduled queue, settings) that preserves the window
 * instead of opening a full-screen modal. */
type RightPane =
  | { mode: "details"; guid: string }
  | { mode: "person"; target: PersonTarget }
  | { mode: "scheduled" }
  | { mode: "settings" };

/** Rendered from the keyboard registry — cannot drift from actual bindings. */
const HELP_ENTRIES = helpEntries();

export default function ChatListScreen() {
  const theme = useTheme();
  const visual = useTriageTheme();
  const { wide, canShadow: canShadowLayout } = useLayoutMode();
  const isFocused = useIsFocused();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();
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
  const [sweep, setSweep] = useState<{ chats: ChatSummary[]; startGuid?: string } | null>(null);
  const { chats, allChats, counts, loading, refresh } = useChats(state, type, !wide);

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
        // Typing is pure presence — it changes nothing the sidebar renders, and
        // scheduling a full list refetch for it meant a chatty conversation kept
        // the whole directory reloading (and starved the debounce during bursts).
        if (event.kind === "typing") return;
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
          laterUntil: null,
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

  // The rail renders on Contacts too; its inbox items reach this screen's
  // filter state through the bus, then navigate here.
  useEffect(() => onRequestInboxFilter(setState), []);

  // The settings gear and the command palette open the scheduled queue /
  // settings as a right-hand pane here instead of a full-screen modal —
  // the shell (list + thread) stays put.
  useEffect(() => {
    if (!wide || !isFocused) return;
    return onOpenScheduledPane(() => setRightPane({ mode: "scheduled" }));
  }, [isFocused, wide]);
  useEffect(() => {
    if (!wide || !isFocused) return;
    return onOpenSettingsPane(() => setRightPane({ mode: "settings" }));
  }, [isFocused, wide]);

  // Details/person panes are per-thread; close them when the selected
  // conversation changes. Scheduled/settings aren't tied to a thread, so a
  // thread switch leaves them open.
  useEffect(() => {
    setRightPane((cur) =>
      cur && (cur.mode === "details" || cur.mode === "person") ? null : cur,
    );
  }, [selected?.guid]);

  // Keep the selected chat's flags fresh as the directory reconciles.
  useEffect(() => {
    if (!selected) return;
    const updated = chats.find((chat) => chat.guid === selected.guid);
    if (updated && updated !== selected) setSelected(updated);
  }, [chats, selected]);

  const openChat = (chat: ChatSummary): void => {
    // Clearing unread emits to the store, which re-filters every conversation
    // and re-renders the list. Do it AFTER the navigation commits, or an unread
    // row pays that whole recompute as tap latency before anything moves.
    const clearUnread = (): void => {
      if (chat.flags.unread) patchChatFlags(chat.guid, { unread: false, unreadCount: 0 });
    };
    if (wide) {
      setJumpTarget(null);
      setSelectionIntent("reply");
      setSelected(chat);
      setListMode(false);
      requestFocus("composer");
      clearUnread();
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
    requestAnimationFrame(clearUnread);
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
  // Synced in an effect, not during render: a render-phase ref write makes the
  // React Compiler bail on this entire screen, and the readers are all keyboard
  // handlers that run well after commit.
  const selectedRef = useRef(selected);
  const overlaysRef = useRef({ helpOpen, searchOpen, rightPane, shadowOpen });
  useEffect(() => {
    selectedRef.current = selected;
    overlaysRef.current = { helpOpen, searchOpen, rightPane, shadowOpen };
  });
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
        finishTriageChat(sel);
        showToast("Done — Z to undo");
        getListAdapter()?.selectNeighborOf(sel.guid);
      },
      laterSelected: () => {
        const sel = selectedRef.current;
        if (!sel) return;
        showSheet({
          title: `Later · ${sel.displayName}`,
          actions: laterOptions().map((option) => ({
            label: option.label,
            onPress: () => {
              void setTriageLater(sel, option.until).then(refresh, () => showToast("Could not move conversation to Later"));
              getListAdapter()?.selectNeighborOf(sel.guid);
            },
          })),
        });
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
      undoLast: () => showToast(undoLastTriageAction() || undoLastAction() ? "Undone" : "Nothing to undo"),
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
      closePanel: () => {
        const o = overlaysRef.current;
        if (o.helpOpen) {
          setHelpOpen(false);
          return true;
        }
        if (o.searchOpen) {
          setSearchOpen(false);
          return true;
        }
        if (getListAdapter()?.clearSearch()) return true;
        if (o.shadowOpen) {
          setShadowOpen(false);
          return true;
        }
        if (o.rightPane) {
          setRightPane(null);
          return true;
        }
        if (selectedRef.current) {
          setSelected(null);
          return true;
        }
        return false;
      },
    });
    const uninstallKeys = installKeyboardDispatcher();
    const uninstallMenu = installNativeMenuBridge();
    return () => {
      uninstallKeys();
      uninstallMenu();
      setKeyboardRuntime(null);
      setListMode(false);
    };
  }, [wide, showSheet, refresh]);

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
      onStartSweep={(sweepChats, startGuid) => setSweep({ chats: sweepChats, startGuid })}
    />
  );

  const inspectorContent = rightPane?.mode === "details" ? (
    <ChatInfoContent
      key={rightPane.guid}
      guid={rightPane.guid}
      showHeader
      onClose={() => setRightPane(null)}
      onOpenPerson={(address, name) => setRightPane({ mode: "person", target: { address, name, backGuid: rightPane.guid } })}
      onDeleted={() => { setRightPane(null); setSelected(null); refresh(); }}
    />
  ) : rightPane?.mode === "person" ? (
    <PersonContent
      key={rightPane.target.address}
      address={rightPane.target.address}
      name={rightPane.target.name}
      showHeader
      backLabel={rightPane.target.backGuid ? "Details" : undefined}
      onBack={rightPane.target.backGuid ? () => setRightPane({ mode: "details", guid: rightPane.target.backGuid }) : undefined}
    />
  ) : rightPane?.mode === "scheduled" ? (
    <ScheduledContent key="scheduled" showHeader onClose={() => setRightPane(null)} />
  ) : rightPane?.mode === "settings" ? (
    <SettingsContent key="settings" showHeader onClose={() => setRightPane(null)} />
  ) : null;

  if (!wide) {
    return <View style={{ flex: 1, backgroundColor: theme.background }}>{list}</View>;
  }

  return (
    <DesktopSplit
      listInset={64}
      list={list}
      detail={
        selected ? (
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
          <EmptyState
            icon="chatbubble-ellipses-outline"
            iconSize={44}
            iconColor={visual.hint}
            style={{ backgroundColor: visual.empty }}
            message={<Text style={{ color: visual.meta, fontSize: 14, fontWeight: "600" }}>Select a conversation</Text>}
          />
        )
      }
    >
      <OverlayShell
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        backdropStyle={styles.overlayBackdrop}
        cardStyle={[styles.overlayPanel, { backgroundColor: visual.overlay, borderColor: visual.hairline }]}
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
      {canShadowLayout ? (
        <DesktopAuxPane open={rightPane !== null}>{inspectorContent}</DesktopAuxPane>
      ) : (
        <OverlayShell
          visible={rightPane !== null}
          onClose={() => setRightPane(null)}
          backdropStyle={styles.inspectorOverlayBackdrop}
          cardStyle={[styles.inspectorOverlayCard, { backgroundColor: visual.inspector, borderColor: visual.hairline }]}
        >
          {inspectorContent}
        </OverlayShell>
      )}
      {canShadow ? (
        <DesktopAuxPane open={shadowOpen && selected !== null}>
          {selected ? (
            <ShadowPanel key={selected.guid} chatGuid={selected.guid} onClose={() => setShadowOpen(false)} />
          ) : null}
        </DesktopAuxPane>
      ) : null}
      <SweepOverlay
        visible={sweep !== null}
        chats={sweep?.chats ?? []}
        startGuid={sweep?.startGuid}
        onOpenFullThread={(chat) => { setSweep(null); openChat(chat); }}
        onClose={() => setSweep(null)}
      />
    </DesktopSplit>
  );
}

const styles = StyleSheet.create({
  // Not fully centered — offset from the top, matching the original inline
  // Modal backdrops this shell replaced.
  inspectorOverlayBackdrop: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  inspectorOverlayCard: {
    borderLeftWidth: 0.5,
    borderRadius: 0,
    height: "100%",
    width: 312,
  },
  overlayBackdrop: {
    backgroundColor: "rgba(18,18,22,0.34)",
    justifyContent: "flex-start",
    paddingTop: 72,
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
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 500,
    maxHeight: "72%",
    maxWidth: "90%",
    overflow: "hidden",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    width: 540,
  },
});
