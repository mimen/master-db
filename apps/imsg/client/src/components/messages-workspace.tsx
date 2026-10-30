import { formatAddress } from "@shared/address";
import { matchesFilters, settleActionFor, settleLeavesLens } from "@shared/chat-state";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";

import { UnknownSenderBanner } from "@/components/contacts-add-panel";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { useDesktopShellContext } from "@/components/desktop-shell-context";
import { DesktopSplit } from "@/components/desktop-split";
import { EmptyState } from "@/components/empty-state";
import { ThreadView } from "@/components/lazy-surfaces";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useChats } from "@/hooks/use-chats";
import { type JumpTarget } from "@/hooks/use-messages";
import { Springs } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";
import { onTriageSettling, toggleSettleChat } from "@/hooks/use-triage-actions";
import { advanceTarget, publishQueuePosition, queueOrder, queuePosition, useRenderedOrder } from "@/hooks/use-queue-position";
import { traceTriage } from "@/lib/triage-trace";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { openAgentPane } from "@/lib/agent-pane";
import { markChatUnread, undoLastAction } from "@/lib/chat-actions";
import { DEFAULT_INBOX_FILTERS, desktopInboxTitle } from "@/lib/inbox-model";
import {
  getListAdapter,
  isListMode,
  requestFocus,
  setKeyboardRuntime,
  setListMode,
} from "@/lib/keyboard/controller";
import { onSelectChat } from "@/lib/selection";
import { playReceive } from "@/lib/sounds";
import { useReceiveSound } from "@/hooks/use-receive-sound";
import { openThreadSearch } from "@/lib/thread-search";
import { showToast } from "@/lib/toast";

/** The lenses where a reply or a settle moves straight on to the next conversation. */
const ADVANCING: ReadonlySet<StateFilter> = new Set(["today", "unresponded", "unread"]);

function chatRoute(chat: ChatSummary) {
  return {
    pathname: "/chat/[guid]" as const,
    params: {
      guid: chat.guid,
      name: chat.displayName,
      isGroup: chat.isGroup ? "1" : "0",
      count: String(chat.participants.length),
      hasGroupPhoto: chat.hasGroupPhoto ? "1" : "0",
    },
  };
}

export function MessagesWorkspace({
  active,
  wide,
}: {
  readonly active: boolean;
  readonly wide: boolean;
}): JSX.Element {
  const theme = useTheme();
  const visual = useTriageTheme();
  const shell = useDesktopShellContext();
  const utilityOpen = shell.state.utility?.workspace === "messages";
  // Today is the working view: the inbox opens on the day's ranked queue.
  const [state, setState] = useState<StateFilter>("today");
  const [type, setType] = useState<TypeFilter>(DEFAULT_INBOX_FILTERS.type);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  // "reply" focuses the composer and marks read; "preview" (glide j/k) does neither.
  const [selectionIntent, setSelectionIntent] = useState<"reply" | "preview">("reply");
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  // The conversation auto-advance opened. Only it slides in; a click cuts as before.
  const [advanced, setAdvanced] = useState<{ guid: string; from: string } | null>(null);
  // The open conversation stays in Today, Needs you or Unread after a reply or a read, until it is
  // left or settled; otherwise the row vanished under the cursor mid-reply.
  const [held, setHeld] = useState<string | null>(null);
  const { chats, allChats, counts, loading, error, refresh } = useChats(state, type, !wide, wide ? held : null);
  const selectedRef = useRef(selected);
  const stateRef = useRef(state);
  const openChatRef = useRef<(chat: ChatSummary) => void>(() => undefined);

  // Wide selection has one synchronous write path. Previously local state and
  // DesktopShell mirrored each other in opposing effects; clicking B while A
  // was selected made both effects publish their stale side and swap A/B every
  // commit. That is the recorded row flicker and the blank, never-settling
  // thread. Route-originated shell state still hydrates local state below.
  const commitChatSelection = useCallback((
    chat: ChatSummary,
    intent: "reply" | "preview",
    target: JumpTarget | null = null,
  ): void => {
    setJumpTarget(target);
    setSelectionIntent(intent);
    setSelected(chat);
    shell.dispatch({
      type: "messages/chat-selected",
      selection: {
        guid: chat.guid,
        name: chat.displayName,
        isGroup: chat.isGroup,
        participantCount: chat.participants.length,
        jumpTarget: target ?? undefined,
        intent,
      },
    });
  }, [shell.dispatch]);

  useReceiveSound(loading ? null : allChats, playReceive);

  // Wide-mode overlays (and the Contacts tab's "message them" action)
  // publish chats to open here instead of navigating.
  useEffect(() => {
    if (!wide) return;
    return onSelectChat((selection) => {
      // Search the unfiltered list: a chat outside the active queue still has a real name.
      const known = allChats.find((chat) => chat.guid === selection.guid);
      const chat = known ?? {
        guid: selection.guid,
        displayName: selection.name ?? placeholderName(selection.guid),
        isGroup: selection.isGroup ?? selection.guid.includes(";+;"),
        known: true,
        isSpam: false,
        participants: [],
        lastMessage: null,
        unreadCount: 0,
        flags: {
          unresponded: false,
          waiting: false,
          unread: false,
          mutedUnresponded: false,
          pinned: false,
        },
      } satisfies ChatSummary;
      commitChatSelection(chat, "reply", selection.jumpTarget ?? null);
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
  }, [allChats, commitChatSelection, wide]);

  useEffect(() => {
    if (!wide) return;
    const selection = shell.state.messages.selection;
    if (!selection) return;
    const known = allChats.find((chat) => chat.guid === selection.guid);
    // Re-resolve a placeholder once the directory loads, so a deep link stops showing its guid.
    if (selected?.guid === selection.guid && (!known || selected.displayName !== placeholderName(selection.guid))) return;
    setJumpTarget(selection.jumpTarget ?? null);
    setSelectionIntent(selection.intent);
    setSelected(
      known ?? {
        guid: selection.guid,
        displayName: selection.name ?? placeholderName(selection.guid),
        isGroup: selection.isGroup ?? selection.guid.includes(";+;"),
        known: true,
        isSpam: false,
        participants: [],
        lastMessage: null,
        unreadCount: 0,
        flags: {
          unresponded: false,
          waiting: false,
          unread: false,
          mutedUnresponded: false,
          pinned: false,
        },
      },
    );
  }, [allChats, selected?.guid, selected?.displayName, shell.state.messages.selection, wide]);

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
        traceTriage({ kind: "clear", via: "clearSelection" });
        setSelected(null);
        shell.dispatch({ type: "messages/chat-settled" });
        router.replace("/");
      },
      openChat: (chat) => {
        commitChatSelection(chat, "reply");
        router.replace({ pathname: "/chat/[guid]", params: { guid: chat.guid, name: chat.displayName } });
      },
      refresh,
    });
    return () => shell.registerMessagesActions(null);
  }, [commitChatSelection, refresh, shell.registerMessagesActions, wide]);

  // Keep the selected chat's flags fresh as the directory reconciles. Read from the
  // whole directory: a reply or a settle moves the open conversation out of the lens.
  // A functional update, because a selection made in the same commit must not be
  // overwritten with the conversation it replaced.
  useEffect(() => {
    setSelected((current) => {
      const updated = current && allChats.find((chat) => chat.guid === current.guid);
      return updated ?? current;
    });
  }, [allChats]);

  const openChat = (chat: ChatSummary): void => {
    if (wide) {
      commitChatSelection(chat, "reply");
      router.replace(chatRoute(chat));
      setListMode(false);
      requestFocus("composer");
      return;
    }
    router.push(chatRoute(chat));
  };

  // Auto-advance (round4 ux.md daily loop): in Today, Needs you and Unread, a reply or a settle
  // moves straight on to the next conversation in lens order with the composer focused.
  // Today's membership is the plan the list renders, fallback included, so it comes from the list.
  const rendered = useRenderedOrder();
  const order = useMemo(() => (state === "today" ? rendered ?? [] : queueOrder(chats)), [chats, rendered, state]);
  useEffect(() => {
    if (!wide || !active) return;
    publishQueuePosition(queuePosition(order, selected?.guid));
    return () => publishQueuePosition(null);
  }, [active, order, selected?.guid, wide]);
  // The neighbor is remembered while the open conversation is still in the lens: by the time
  // a send's echo or a settle lands, the conversation has already left Needs you.
  const nextRef = useRef<ChatSummary | null>(null);
  // Rerun on the rendered order too: folding a section changes what the next conversation is.
  useEffect(() => {
    if (selected && order.some((chat) => chat.guid === selected.guid)) nextRef.current = advanceTarget(order, selected.guid);
  }, [order, rendered, selected]);
  // A phone thread is a pushed route, not a selection: settling the one on screen replaces it with the next.
  const pathname = usePathname();
  const routeGuid = useGlobalSearchParams<{ guid?: string }>().guid;
  const phoneThreadRef = useRef<string | null>(null);
  phoneThreadRef.current = pathname.startsWith("/chat/") ? routeGuid ?? null : null;
  const orderRef = useRef(order);
  orderRef.current = order;
  const advanceFrom = useCallback((guid: string): void => {
    if (!ADVANCING.has(stateRef.current)) return traceTriage({ kind: "advance", from: guid, to: null, reason: `lens ${stateRef.current}` });
    if (!wide) {
      if (phoneThreadRef.current !== guid) return traceTriage({ kind: "advance", from: guid, to: null, reason: "thread not open" });
      const next = advanceTarget(orderRef.current, guid);
      if (!next || next.guid === guid) return traceTriage({ kind: "advance", from: guid, to: null, reason: next ? "next is self" : "no next" });
      traceTriage({ kind: "advance", from: guid, to: next.guid, reason: "ok" });
      router.replace(chatRoute(next));
      return;
    }
    if (selectedRef.current?.guid !== guid) return traceTriage({ kind: "advance", from: guid, to: null, reason: `selected ${selectedRef.current?.guid.slice(-6) ?? "none"}` });
    const next = nextRef.current;
    if (!next || next.guid === guid) return traceTriage({ kind: "advance", from: guid, to: null, reason: next ? "next is self" : "no next" });
    traceTriage({ kind: "advance", from: guid, to: next.guid, reason: "ok" });
    setAdvanced({ guid: next.guid, from: selectedRef.current.displayName });
    openChatRef.current(next);
  }, [wide]);
  useEffect(() => onTriageSettling(advanceFrom), [advanceFrom]);
  const allChatsRef = useRef(allChats);
  const renderedRef = useRef(rendered);
  useEffect(() => {
    allChatsRef.current = allChats;
    renderedRef.current = rendered;
  });
  const selectedGuid = selected?.guid;
  useEffect(() => {
    const chat = selectedGuid ? allChatsRef.current.find((c) => c.guid === selectedGuid) : undefined;
    const shown = !chat || !ADVANCING.has(state) ? false
      : state === "today" ? renderedRef.current?.some((c) => c.guid === chat.guid) === true
      : matchesFilters(chat, state, type);
    setHeld(chat && shown ? chat.guid : null);
  }, [selectedGuid, state, type]);
  useEffect(() => onTriageSettling((guid) => setHeld((current) => (current === guid ? null : current))), []);
  /** Glide-mode j/k: show the thread, keep list focus, don't mark read. */
  const previewChat = (chat: ChatSummary): void => {
    commitChatSelection(chat, "preview");
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
  const agentEnabled = useAgentEnabled();
  const overlaysRef = useRef({ utilityOpen, agentEnabled });
  useEffect(() => {
    selectedRef.current = selected;
    stateRef.current = state;
    openChatRef.current = openChat;
    overlaysRef.current = { utilityOpen, agentEnabled };
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
      settleSelected: () => {
        const sel = selectedRef.current;
        if (!sel) {
          showToast("Select a conversation first");
          return;
        }
        // No lens gate. The gesture acts on the selected conversation from any
        // lens, and toggleSettleChat answers every press with a toast.
        const action = settleActionFor(sel);
        traceTriage({ kind: "settle-key", guid: sel.guid, lens: stateRef.current, action, next: nextRef.current?.guid ?? null });
        void toggleSettleChat(sel);
        // Today, Needs you and Unread auto-advance on the settle itself (onTriageSettling).
        // Elsewhere, glide off the row only when the action drops it out of the lens.
        const advances = action === "settle" && ADVANCING.has(stateRef.current);
        if (!advances && settleLeavesLens(action, stateRef.current)) getListAdapter()?.selectNeighborOf(sel.guid);
      },
      markUnreadSelected: () => {
        const sel = selectedRef.current;
        if (!sel) {
          showToast("Select a conversation first");
          return;
        }
        markChatUnread(sel, () => showToast("Marked unread — ⌘⇧Z to undo"));
      },
      toggleDetails: () => {
        const sel = selectedRef.current;
        if (!sel) return;
        shell.dispatch({
          type: "utility/toggled",
          utility: { kind: "chat-info", workspace: "messages", guid: sel.guid },
        });
      },
      openAgent: () => {
        const sel = selectedRef.current;
        if (sel && overlaysRef.current.agentEnabled) openAgentPane(sel.guid);
      },
      focusListSearch: () => getListAdapter()?.focusSearch(),
      undoLast: () => showToast(undoLastAction() ? "Undone" : "Nothing to undo"),
      // Esc precedence ladder — first applicable step only.
      escape: () => {
        if (shell.closeTopSurface()) return;
        const o = overlaysRef.current;
        const focused = globalThis.document.activeElement;
        if (focused instanceof HTMLElement && focused.closest("[data-agent-pane]")) {
          requestFocus("composer");
          return;
        }
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
        if (o.utilityOpen) {
          shell.closeUtility();
          return true;
        }
        if (selectedRef.current) {
          traceTriage({ kind: "clear", via: "closePanel" });
          setSelected(null);
          shell.dispatch({ type: "messages/chat-settled" });
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
  }, [active, wide, refresh, shell.closeTopSurface, shell.closeUtility, shell.dispatch, shell.openHelp, shell.openPalette]);

  const list = (
    <ConversationListPane
      chats={chats}
      allChats={allChats}
      counts={counts}
      filters={{ state, type }}
      loading={loading}
      offline={error !== null}
      wide={wide}
      selectedGuid={wide ? selected?.guid : undefined}
      held={wide ? held : null}
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

  return (
    <DesktopSplit
      list={list}
      detail={
        selected ? (
          <ThreadEnter key={selected.guid + (jumpTarget?.guid ?? "")} animate={selected.guid === advanced?.guid}>
            <ThreadView
              chatGuid={selected.guid}
              isGroup={selected.isGroup}
              jumpTarget={jumpTarget}
              headerChat={selected}
              lensLabel={desktopInboxTitle({ state, type })}
              previewOnly={selectionIntent === "preview"}
              advancedFrom={selected.guid === advanced?.guid ? advanced.from : undefined}
              toastActive={active}
            />
            <UnknownSenderBanner key={selected.guid} chat={selected} />
          </ThreadEnter>
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
    />
  );
}


/**
 * The next thread entering from 14px below on smooth (round4 motion.md, auto-advance).
 * Keyed per conversation by the caller, so each advance mounts and plays it once.
 */
function ThreadEnter({ animate, children }: { readonly animate: boolean; readonly children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    progress.value = reduceMotion ? withTiming(1, { duration: 0 }) : withSpring(1, Springs.smooth);
  }, [animate, progress, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * 14 }],
  }));
  return <Reanimated.View style={[{ flex: 1 }, style]}>{children}</Reanimated.View>;
}

/** Before the directory loads, a deep-linked chat shows its handle rather than its raw guid. */
function placeholderName(guid: string): string {
  return guid.includes(";+;") ? "Group conversation" : formatAddress(guid.split(";").pop() ?? guid);
}
