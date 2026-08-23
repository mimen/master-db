import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { Platform, Text, useWindowDimensions, View } from "react-native";

import { ConversationListPane } from "@/components/conversation-list-pane";
import { useDesktopShellContext } from "@/components/desktop-shell-context";
import { DesktopAuxPane, DesktopSplit } from "@/components/desktop-split";
import { EmptyState } from "@/components/empty-state";
import { ShadowPanel } from "@/components/shadow-panel";
import { SweepOverlay } from "@/components/sweep-overlay";
import { ThreadView } from "@/components/thread-view";
import { useAiStatus } from "@/hooks/use-ai";
import { useChats } from "@/hooks/use-chats";
import type { JumpTarget } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { calculatePaneAdmission } from "@/lib/desktop-coordinator/pane-admission";
import { AUX_PANE_WIDTH } from "@/lib/desktop-frame";
import { useSidebarWidth } from "@/lib/sidebar-width";
import { finishTriageChat, laterOptions, setTriageLater, undoLastTriageAction } from "@/hooks/use-triage-actions";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { useActionSheet } from "@/lib/action-sheet";
import { markChatUnread, undoLastAction } from "@/lib/chat-actions";
import { patchChatFlags, patchChatWithMessage } from "@/lib/chat-store";
import {
  getListAdapter,
  isListMode,
  requestFocus,
  setKeyboardRuntime,
  setListMode,
} from "@/lib/keyboard/controller";
import { onSelectChat } from "@/lib/selection";
import { playReceive } from "@/lib/sounds";
import { useServerEvents } from "@/lib/sse";
import { openThreadSearch } from "@/lib/thread-search";
import { showToast } from "@/lib/toast";

export function MessagesWorkspace({
  active,
  wide,
  utilityPane = null,
}: {
  readonly active: boolean;
  readonly wide: boolean;
  readonly utilityPane?: ReactNode;
}): JSX.Element {
  const theme = useTheme();
  const visual = useTriageTheme();
  const shell = useDesktopShellContext();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();
  const { width: windowWidth } = useWindowDimensions();
  const [sidebarWidth] = useSidebarWidth();
  const utilityOpen = shell.state.utility?.workspace === "messages";
  const canShadow =
    calculatePaneAdmission({ windowWidth, sidebarWidth, sidePaneWidth: AUX_PANE_WIDTH }).sidePane === "pane" &&
    !utilityOpen &&
    aiStatus?.shadow === true;
  const [shadowOpen, setShadowOpen] = useState(false);
  useEffect(() => {
    if (shadowOpen && !canShadow) setShadowOpen(false);
  }, [canShadow, shadowOpen]);
  // Unresponded is the working view — the inbox opens on what needs a reply.
  const [state, setState] = useState<StateFilter>("unresponded");
  const [type, setType] = useState<TypeFilter>("all");
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  // "reply" focuses the composer and marks read; "preview" (glide j/k) does neither.
  const [selectionIntent, setSelectionIntent] = useState<"reply" | "preview">("reply");
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
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
      router.replace({
        pathname: "/chat/[guid]",
        params: {
          guid: selection.guid,
          ...(selection.name ? { name: selection.name } : {}),
          ...(selection.jumpTarget
            ? {
                targetGuid: selection.jumpTarget.guid,
                targetDate: String(selection.jumpTarget.dateCreated),
              }
            : {}),
        },
      });
    });
  }, [wide, chats]);

  useEffect(() => {
    if (!wide) return;
    const selection = shell.state.messages.selection;
    if (!selection || selected?.guid === selection.guid) return;
    const known = chats.find((chat) => chat.guid === selection.guid);
    setJumpTarget(selection.jumpTarget ?? null);
    setSelectionIntent(selection.intent);
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
  }, [chats, selected?.guid, shell.state.messages.selection, wide]);

  // The shell owns the one rail and the one utility surface. Messages keeps
  // its filters and selection local so they survive workspace switches, then
  // reports only the chrome state/actions the shell needs.
  useEffect(() => {
    if (!wide) return;
    shell.reportMessagesRail({ allChats, counts, state, type });
  }, [allChats, counts, shell.reportMessagesRail, state, type, wide]);
  useEffect(() => {
    if (!wide) return;
    shell.registerMessagesActions({
      applyState: setState,
      applyType: setType,
      clearSelection: () => {
        setSelected(null);
        shell.dispatch({ type: "messages/chat-cleared" });
        router.replace("/");
      },
      openChat: (chat) => {
        setJumpTarget(null);
        setSelectionIntent("reply");
        setSelected(chat);
        router.replace({ pathname: "/chat/[guid]", params: { guid: chat.guid, name: chat.displayName } });
      },
      refresh,
    });
    return () => shell.registerMessagesActions(null);
  }, [refresh, shell.registerMessagesActions, wide]);
  useEffect(() => {
    if (!wide || !selected) return;
    shell.dispatch({
      type: "messages/chat-selected",
      selection: {
        guid: selected.guid,
        name: selected.displayName,
        isGroup: selected.isGroup,
        participantCount: selected.participants.length,
        jumpTarget: jumpTarget ?? undefined,
        intent: selectionIntent,
      },
    });
  }, [jumpTarget, selected, selectionIntent, shell.dispatch, wide]);
  useEffect(() => {
    if (!wide || active) return;
    setShadowOpen(false);
    setSweep(null);
  }, [active, wide]);

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
      router.replace({
        pathname: "/chat/[guid]",
        params: {
          guid: chat.guid,
          name: chat.displayName,
          isGroup: chat.isGroup ? "1" : "0",
          count: String(chat.participants.length),
        },
      });
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
    globalThis.requestAnimationFrame(clearUnread);
  };

  /** Glide-mode j/k: show the thread, keep list focus, don't mark read. */
  const previewChat = (chat: ChatSummary): void => {
    setJumpTarget(null);
    setSelectionIntent("preview");
    setSelected(chat);
  };

  const openNewMessage = (): void => {
    if (wide) {
      shell.openPalette(true);
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
  const overlaysRef = useRef({ shadowOpen, utilityOpen });
  useEffect(() => {
    selectedRef.current = selected;
    overlaysRef.current = { shadowOpen, utilityOpen };
  });
  useEffect(() => {
    if (Platform.OS !== "web" || !wide || !active) return;
    setKeyboardRuntime({
      openPalette: () => shell.openPalette(false),
      openNewMessage: () => shell.openPalette(true),
      openHelp: shell.openHelp,
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
        shell.dispatch({
          type: "utility/toggled",
          utility: { kind: "chat-info", workspace: "messages", guid: sel.guid },
        });
      },
      focusListSearch: () => getListAdapter()?.focusSearch(),
      undoLast: () => showToast(undoLastTriageAction() || undoLastAction() ? "Undone" : "Nothing to undo"),
      // Esc precedence ladder — first applicable step only.
      escape: () => {
        if (shell.closeTopSurface()) return;
        const o = overlaysRef.current;
        // An active list search clears before anything else closes.
        if (getListAdapter()?.clearSearch()) return;
        if (!isListMode()) {
          // From the composer (or anywhere non-glide): enter glide mode.
          const active = globalThis.document.activeElement;
          if (active instanceof HTMLElement) active.blur();
          setListMode(true);
          return;
        }
        if (o.utilityOpen) return shell.closeUtility();
        // Already gliding with nothing to close — stay.
      },
      closePanel: () => {
        if (shell.closeTopSurface()) return true;
        const o = overlaysRef.current;
        if (getListAdapter()?.clearSearch()) return true;
        if (o.shadowOpen) {
          setShadowOpen(false);
          return true;
        }
        if (o.utilityOpen) {
          shell.closeUtility();
          return true;
        }
        if (selectedRef.current) {
          setSelected(null);
          shell.dispatch({ type: "messages/chat-cleared" });
          router.replace("/");
          return true;
        }
        return false;
      },
    });
    return () => {
      setKeyboardRuntime(null);
      setListMode(false);
    };
  }, [active, wide, showSheet, refresh, shell.closeTopSurface, shell.closeUtility, shell.dispatch, shell.openHelp, shell.openPalette]);

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

  if (!wide) {
    return <View style={{ flex: 1, backgroundColor: theme.background }}>{list}</View>;
  }

  return (
    <DesktopSplit
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
      {utilityPane}
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
