import { router, useGlobalSearchParams, usePathname } from "expo-router";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  createDesktopShellStore,
  DesktopShellContext,
  type MessagesRailState,
  type MessagesWorkspaceActions,
} from "@/components/desktop-shell-context";
import { DesktopUtilityPane } from "@/components/desktop-split";
import {
  AgentPane,
  ChatInfoContent,
  CommandPalette,
  ContactsWorkspace,
  MailWorkspace,
  ForwardContent,
  KeyboardHelp,
  NewChatContent,
  PersonContent,
  preloadSurfaces,
  ScheduledContent,
  SearchContent,
  SettingsContent,
} from "@/components/lazy-surfaces";
import { MessagesWorkspace } from "@/components/messages-workspace";
import { OverlayShell } from "@/components/overlay-shell";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useAgentToasts } from "@/hooks/use-agent-toasts";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { onOpenAgentPane } from "@/lib/agent-pane";
import { useMailSelection } from "@/lib/mail-selection";
import { onOpenChatInfo } from "@/lib/chat-info";
import { DEFAULT_INBOX_FILTERS } from "@/lib/inbox-model";
import { lensFilters } from "@/lib/palette/saved-views";
import { WANTS_YOU } from "@shared/agent-attention";
import type { ConversationId } from "@shared/types";
import {
  createInitialDesktopShellState,
  INITIAL_DESKTOP_SHELL_STATE,
} from "@/lib/desktop-coordinator/reducer";
import { projectDesktopRoute } from "@/lib/desktop-coordinator/route";
import { workspacePath, type WorkspaceId } from "@/lib/workspaces";
import type {
  DesktopRouteParams,
  DesktopRouteProjection,
  DesktopUtility,
} from "@/lib/desktop-coordinator/types";
import { onOpenPersonPane } from "@/lib/person-pane";
import { conversationRoute } from "@/lib/selection";
import { onOpenScheduledPane } from "@/lib/scheduled-pane";
import { onOpenSettingsPane } from "@/lib/settings-pane";
import { installNativeMenuBridge } from "@/lib/desktop-shell";
import { runEscapeClosers, setKeyboardRuntime } from "@/lib/keyboard/controller";
import { installKeyboardDispatcher } from "@/lib/keyboard/dispatcher";

function desktopProjection(
  pathname: string,
  params: DesktopRouteParams,
  previousWorkspace?: WorkspaceId,
): DesktopRouteProjection | null {
  const result = projectDesktopRoute(pathname, params, previousWorkspace);
  return result.ok ? result.value : null;
}

/** Room for round4 desk-settings: label and dropdown on one line in a 576px column. */
const SETTINGS_PANE_WIDTH = 640;
/** A transcript with question cards reads poorly at the 312 minimum. */
const AGENT_PANE_WIDTH = 420;

/** Its own component so each agent list update re-renders only this, not the shell. */
function AgentToasts({ lookingAt }: { readonly lookingAt: string | null }): null {
  useAgentToasts(lookingAt);
  return null;
}

function utilityForPerson(
  workspace: WorkspaceId,
  target: { readonly address: string; readonly name?: string },
  backConversation?: ConversationId,
): DesktopUtility {
  return {
    kind: "person",
    workspace,
    target,
    ...(backConversation ? { backConversation } : {}),
  };
}

export function DesktopShellProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const params = useGlobalSearchParams() as DesktopRouteParams;
  const { wide } = useLayoutMode();
  const theme = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteCompose, setPaletteCompose] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [store] = useState(() => {
    const initialProjection = desktopProjection(pathname, params);
    return createDesktopShellStore(initialProjection ? createInitialDesktopShellState(initialProjection) : INITIAL_DESKTOP_SHELL_STATE);
  });
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const dispatch = store.dispatch;
  // Keyed by content, so the projection changes only when the route does.
  const paramsKey = JSON.stringify(params);
  const routeParams = useMemo(() => JSON.parse(paramsKey) as DesktopRouteParams, [paramsKey]);
  const projection = useMemo(
    () => desktopProjection(pathname, routeParams, state.activeWorkspace),
    [pathname, routeParams, state.activeWorkspace],
  );
  const [messagesRail, setMessagesRail] = useState<MessagesRailState>({
    allChats: [],
    counts: null,
    state: "unresponded",
    type: DEFAULT_INBOX_FILTERS.type,
  });
  const messagesActions = useRef<MessagesWorkspaceActions | null>(null);
  const activeWorkspace = projection?.workspace ?? state.activeWorkspace;
  // Contacts mounts on first visit, then stays mounted. Its people list is about 440 KB that
  // would otherwise share the boot socket with the first conversation page and first open.
  const [contactsVisited, setContactsVisited] = useState(false);
  if (activeWorkspace === "contacts" && !contactsVisited) setContactsVisited(true);
  // Mail, likewise: its chunk and its first page wait for the first visit.
  const [mailVisited, setMailVisited] = useState(false);
  if (activeWorkspace === "mail" && !mailVisited) setMailVisited(true);
  const shellOwnsRoute = wide && projection !== null;
  const agentEnabled = useAgentEnabled();
  const mailSelection = useMailSelection();
  const agentOpen = useRef(false);
  // A pane hidden by a stale runner or the setting closes for real, so Esc and ⌘W are not spent on it.
  const agentHidden = state.utility?.kind === "agent" && !agentEnabled;
  useEffect(() => {
    if (agentHidden) dispatch({ type: "utility/closed" });
  }, [agentHidden]);
  // Opening a conversation whose agent wants the user opens its pane, as does any pick in the Agents
  // lens. The pane then shows the most urgent chat, the one the row's badge names. Focus stays where
  // the open put it, so j/k keeps walking the list. Any pane already open, Settings or chat info
  // included, stays put.
  const selectedId = state.messages.selection?.conversationId;
  const autoOpen = useRef({ wide: false, agentEnabled, rail: messagesRail, utilityOpen: false });
  // Synced in an effect, not during render: a render-phase ref write makes the React Compiler skip this
  // provider, and then every shell render re-renders both workspaces. Declared first, so it runs first.
  useEffect(() => {
    agentOpen.current = state.utility?.kind === "agent";
    autoOpen.current = { wide: wide && projection !== null, agentEnabled, rail: messagesRail, utilityOpen: state.utility !== null };
  });
  useEffect(() => {
    const { wide: shellWide, agentEnabled: enabled, rail, utilityOpen } = autoOpen.current;
    if (!shellWide || !enabled || !selectedId || utilityOpen) return;
    const agent = rail.allChats.find((chat) => chat.conversationId === selectedId)?.agent;
    if (agent && (rail.state === "agents" || WANTS_YOU.has(agent.attention))) {
      dispatch({ type: "utility/toggled", utility: { kind: "agent", workspace: "messages" } });
    }
  }, [selectedId]);

  useEffect(() => {
    if (projection === null) {
      if (wide) {
        dispatch({ type: "utility/closed" });
      }
      return;
    }
    dispatch({ type: "route/committed", route: projection });
  }, [projection, wide]);

  useEffect(() => {
    // After the list has had the link to itself, fetch the surface chunks so a first open has no empty frame.
    const timer = setTimeout(() => (globalThis.requestIdleCallback ?? setTimeout)(preloadSurfaces), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!wide) return;
    const uninstallKeys = installKeyboardDispatcher();
    const uninstallMenu = installNativeMenuBridge();
    return () => {
      uninstallKeys();
      uninstallMenu();
      setKeyboardRuntime(null);
    };
  }, [wide]);

  useEffect(() => {
    if (!shellOwnsRoute) return;
    const stopChatInfo = onOpenChatInfo((conversationId) => {
      dispatch({
        type: "utility/toggled",
        utility: { kind: "chat-info", workspace: "messages", conversationId },
      });
    });
    const stopPerson = onOpenPersonPane((target) => {
      dispatch({
        type: "utility/toggled",
        utility: utilityForPerson(
          activeWorkspace,
          { address: target.address, name: target.name },
          activeWorkspace === "messages" ? target.backConversation : undefined,
        ),
      });
    });
    const stopScheduled = onOpenScheduledPane(() => {
      dispatch({
        type: "utility/toggled",
        utility: { kind: "scheduled", workspace: activeWorkspace },
      });
    });
    const stopSettings = onOpenSettingsPane(() => {
      dispatch({
        type: "utility/toggled",
        utility: { kind: "settings", workspace: activeWorkspace },
      });
    });
    const stopAgent = onOpenAgentPane(() => {
      if (agentOpen.current) return;
      dispatch({ type: "utility/toggled", utility: { kind: "agent", workspace: activeWorkspace === "mail" ? "mail" : "messages" } });
    });
    return () => {
      stopAgent();
      stopChatInfo();
      stopPerson();
      stopScheduled();
      stopSettings();
    };
  }, [activeWorkspace, shellOwnsRoute]);

  const registerMessagesActions = useCallback((actions: MessagesWorkspaceActions | null): void => {
    messagesActions.current = actions;
  }, []);
  const reportMessagesRail = useCallback((next: MessagesRailState): void => {
    setMessagesRail(next);
  }, []);
  const openPalette = useCallback((compose = false): void => {
    setPaletteCompose(compose);
    setPaletteOpen(true);
  }, []);
  const openHelp = useCallback((): void => setHelpOpen(true), []);
  // The callbacks below read this, so they stay stable and the context never changes.
  const latest = useRef({ activeWorkspace, helpOpen, paletteOpen, projectionKind: projection?.kind });
  useEffect(() => {
    latest.current = { activeWorkspace, helpOpen, paletteOpen, projectionKind: projection?.kind };
  });
  const closeProjectedRoute = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace(workspacePath(latest.current.activeWorkspace));
  }, []);
  const closeTopSurface = useCallback((): boolean => {
    if (latest.current.helpOpen) {
      setHelpOpen(false);
      return true;
    }
    if (latest.current.paletteOpen) {
      setPaletteOpen(false);
      return true;
    }
    if (store.getState().routeOverlay) {
      closeProjectedRoute();
      return true;
    }
    return false;
  }, [closeProjectedRoute, store]);
  const closeUtility = useCallback((): void => {
    dispatch({ type: "utility/closed" });
    if (latest.current.projectionKind === "utility") closeProjectedRoute();
  }, [closeProjectedRoute, dispatch]);

  useEffect(() => {
    if (!shellOwnsRoute || activeWorkspace !== "contacts") return;
    const closeContactsPanel = (): boolean => {
      if (closeTopSurface() || runEscapeClosers()) return true;
      if (!state.utility) return false;
      dispatch({ type: "utility/closed" });
      if (projection?.kind === "utility") router.replace(workspacePath(activeWorkspace));
      return true;
    };
    setKeyboardRuntime({
      openPalette: () => openPalette(false),
      openNewMessage: () => router.push({ pathname: "/new-chat", params: { workspace: "contacts" } }),
      openHelp,
      moveSelection: () => undefined,
      activateSelection: () => undefined,
      findInConversation: () => undefined,
      settleSelected: () => undefined,
      markUnreadSelected: () => undefined,
      deferSelected: () => undefined,
      toggleDetails: () => undefined,
      openAgent: () => undefined,
      focusListSearch: () => undefined,
      undoLast: () => undefined,
      escape: () => { closeContactsPanel(); },
      closePanel: closeContactsPanel,
    });
    return () => setKeyboardRuntime(null);
  }, [activeWorkspace, closeTopSurface, openHelp, openPalette, projection?.kind, shellOwnsRoute, state.utility]);

  const context = useMemo(
    () => ({
      store,
      closeTopSurface,
      closeUtility,
      dispatch,
      openHelp,
      openPalette,
      registerMessagesActions,
      reportMessagesRail,
    }),
    [store, closeTopSurface, closeUtility, dispatch, openHelp, openPalette, registerMessagesActions, reportMessagesRail],
  );
  const utilityIsGlobal = state.utility?.kind === "scheduled" || state.utility?.kind === "settings";
  // In Mail the pane follows the open email thread, fed the same way a chat feeds it.
  const agentConversation = !agentEnabled ? undefined
    : activeWorkspace === "mail" ? mailSelection ?? undefined : state.messages.selection?.conversationId;
  const utility =
    shellOwnsRoute && state.utility && (utilityIsGlobal || state.utility.workspace === activeWorkspace) &&
    (state.utility.kind !== "agent" || agentConversation !== undefined)
      ? state.utility
      : null;
  const phoneAgentConversation = pathname === "/agent" && typeof params.conversation === "string" ? params.conversation as ConversationId : null;
  const utilityContent = utility?.kind === "agent" && agentConversation ? (
    <AgentPane key={agentConversation} conversationId={agentConversation} onClose={closeUtility} />
  ) : utility?.kind === "chat-info" ? (
    <ChatInfoContent
      key={utility.conversationId}
      conversationId={utility.conversationId}
      showHeader
      onClose={closeUtility}
      onOpenPerson={(address, name) => {
        dispatch({
          type: "utility/toggled",
          utility: utilityForPerson("messages", { address, name }, utility.conversationId),
        });
      }}
      onDeleted={() => {
        closeUtility();
        messagesActions.current?.clearSelection();
        messagesActions.current?.refresh();
      }}
    />
  ) : utility?.kind === "person" ? (
    <PersonContent
      key={utility.target.address}
      address={utility.target.address}
      name={utility.target.name}
      showHeader
      backLabel={utility.backConversation ? "Details" : undefined}
      onBack={utility.backConversation ? () => {
        dispatch({
          type: "utility/toggled",
          utility: { kind: "chat-info", workspace: "messages", conversationId: utility.backConversation! },
        });
      } : undefined}
      onClose={closeUtility}
    />
  ) : utility?.kind === "scheduled" ? (
    <ScheduledContent key="scheduled" showHeader onClose={closeUtility} />
  ) : utility?.kind === "settings" ? (
    <SettingsContent key="settings" showHeader onClose={closeUtility} />
  ) : null;
  const utilityPane = (
    <DesktopUtilityPane open={utility !== null} onClose={closeUtility} width={utility?.kind === "settings" ? SETTINGS_PANE_WIDTH : utility?.kind === "agent" ? AGENT_PANE_WIDTH : undefined}>
      {utilityContent}
    </DesktopUtilityPane>
  );
  const closeRouteSurface = closeProjectedRoute;
  const routeOverlay = shellOwnsRoute ? state.routeOverlay : null;
  const routeOverlayContent = routeOverlay?.kind === "search" ? (
    <SearchContent
      initialQuery={routeOverlay.query}
      scopeConversation={routeOverlay.conversationId}
      scopeLabel={routeOverlay.chatName}
      onClose={closeRouteSurface}
    />
  ) : routeOverlay?.kind === "new-chat" ? (
    <NewChatContent
      initialContact={routeOverlay.initialContact
        ? {
            address: routeOverlay.initialContact.address,
            name: routeOverlay.initialContact.name ?? routeOverlay.initialContact.address,
          }
        : undefined}
      onClose={closeRouteSurface}
    />
  ) : routeOverlay?.kind === "forward" ? (
    <ForwardContent
      onClose={closeRouteSurface}
      onOpenChat={(chat) => {
        router.replace(conversationRoute(chat.conversationId));
      }}
    />
  ) : null;

  return (
    <DesktopShellContext.Provider value={context}>
      <View style={styles.root}>
        <AgentToasts lookingAt={wide ? (utility?.kind === "agent" ? agentConversation ?? null : null) : phoneAgentConversation} />
        <View
          style={shellOwnsRoute ? styles.hiddenRouteHost : styles.routeHost}
          accessibilityElementsHidden={shellOwnsRoute}
          importantForAccessibility={shellOwnsRoute ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        {wide ? (
          <View
            testID="desktop-shell"
            style={[styles.shell, !shellOwnsRoute && styles.inactiveShell]}
            {...({ dataSet: {
              utilityKind: state.utility?.kind ?? "",
              utilityWorkspace: state.utility?.workspace ?? "",
            } } as object)}
            accessibilityElementsHidden={!shellOwnsRoute}
            importantForAccessibility={shellOwnsRoute ? "auto" : "no-hide-descendants"}
          >
            <View style={styles.workspaceHost}>
              <View
                style={[styles.workspace, activeWorkspace !== "messages" && styles.inactiveWorkspace]}
                accessibilityElementsHidden={!shellOwnsRoute || activeWorkspace !== "messages"}
                importantForAccessibility={shellOwnsRoute && activeWorkspace === "messages" ? "auto" : "no-hide-descendants"}
              >
                <MessagesWorkspace
                  active={shellOwnsRoute && activeWorkspace === "messages"}
                  wide
                />
              </View>
              <View
                style={[styles.workspace, activeWorkspace !== "contacts" && styles.inactiveWorkspace]}
                accessibilityElementsHidden={activeWorkspace !== "contacts"}
                importantForAccessibility={activeWorkspace === "contacts" ? "auto" : "no-hide-descendants"}
              >
                {contactsVisited ? <ContactsWorkspace wide /> : null}
              </View>
              <View
                style={[styles.workspace, activeWorkspace !== "mail" && styles.inactiveWorkspace]}
                accessibilityElementsHidden={activeWorkspace !== "mail"}
                importantForAccessibility={activeWorkspace === "mail" ? "auto" : "no-hide-descendants"}
              >
                {mailVisited ? <MailWorkspace wide active={shellOwnsRoute && activeWorkspace === "mail"} /> : null}
              </View>
            </View>
            {utilityPane}
            <OverlayShell
              visible={routeOverlay !== null}
              onClose={closeRouteSurface}
              backdropStyle={styles.routeOverlayBackdrop}
              cardStyle={styles.routeOverlayCard}
            >
              {routeOverlayContent}
            </OverlayShell>
            <OverlayShell
              visible={paletteOpen}
              onClose={() => setPaletteOpen(false)}
              accessibilityLabel="Command palette"
              backdropStyle={styles.paletteBackdrop}
              // The palette draws its own popover card, radius and shadow included.
              card={false}
              cardStyle={styles.paletteCard}
            >
              <CommandPalette
                key={paletteCompose ? "compose" : "root"}
                chats={[...messagesRail.allChats]}
                initialMode={paletteCompose ? "compose" : "root"}
                onClose={() => setPaletteOpen(false)}
                onOpenChat={(chat) => messagesActions.current?.openChat(chat)}
                onApplyState={(next) => {
                  messagesActions.current?.applyState(next);
                  dispatch({
                    type: "messages/filters-changed",
                    filters: { state: next, type: lensFilters(next, DEFAULT_INBOX_FILTERS.type).type },
                  });
                  if (activeWorkspace !== "messages") router.replace("/");
                }}
                onApplyType={(next) => {
                  messagesActions.current?.applyType(next);
                  dispatch({
                    type: "messages/filters-changed",
                    filters: { state: messagesRail.state, type: next },
                  });
                  if (activeWorkspace !== "messages") router.replace("/");
                }}
                onShowHelp={() => setHelpOpen(true)}
              />
            </OverlayShell>
            <OverlayShell
              visible={helpOpen}
              accessibilityLabel="Keyboard shortcuts"
              onClose={() => setHelpOpen(false)}
              backdropStyle={[styles.paletteBackdrop, styles.helpBackdrop]}
              cardStyle={[styles.helpCard, { borderColor: theme.cardBorder }]}
            >
              <KeyboardHelp />
            </OverlayShell>
          </View>
        ) : null}
      </View>
    </DesktopShellContext.Provider>
  );
}

const styles = StyleSheet.create({
  hiddenRouteHost: {
    display: "none",
  },
  inactiveShell: {
    display: "none",
  },
  inactiveWorkspace: {
    display: "none",
  },
  root: {
    flex: 1,
  },
  routeHost: {
    flex: 1,
  },
  helpCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "90%",
    paddingHorizontal: 22,
    paddingVertical: 20,
    width: 360,
  },
  // No color here: OverlayShell's default is the scheme's scrim (tokens `backdrop`).
  paletteBackdrop: {
    justifyContent: "flex-start",
    paddingTop: 96,
  },
  helpBackdrop: { backgroundColor: "rgba(18,18,22,0.34)" },
  paletteCard: {
    maxHeight: "80%",
    maxWidth: 620,
    width: "90%",
  },
  routeOverlayBackdrop: {
    backgroundColor: "rgba(18,18,22,0.34)",
    padding: 48,
  },
  routeOverlayCard: {
    borderRadius: 16,
    height: "92%",
    maxHeight: 720,
    maxWidth: 720,
    overflow: "hidden",
    width: "92%",
  },
  shell: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
  },
  workspace: {
    ...StyleSheet.absoluteFill,
  },
  workspaceHost: {
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
});
