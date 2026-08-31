import { router, useGlobalSearchParams, usePathname } from "expo-router";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ChatInfoContent } from "@/components/chat-info-content";
import { CommandPalette } from "@/components/command-palette";
import { ContactsWorkspace } from "@/components/contacts-workspace";
import {
  DesktopShellContext,
  type MessagesRailState,
  type MessagesWorkspaceActions,
} from "@/components/desktop-shell-context";
import { DesktopUtilityPane } from "@/components/desktop-split";
import { ForwardContent } from "@/components/forward-content";
import { MessagesWorkspace } from "@/components/messages-workspace";
import { NewChatContent } from "@/components/new-chat-content";
import { OverlayShell } from "@/components/overlay-shell";
import { PersonContent } from "@/components/person-content";
import { SearchContent } from "@/components/search-content";
import { ScheduledContent } from "@/components/scheduled-content";
import { SettingsContent } from "@/components/settings-content";
import { TriageNavigationRail } from "@/components/triage-navigation-rail";
import { Type } from "@/constants/theme";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { onOpenChatInfo } from "@/lib/chat-info";
import {
  createInitialDesktopShellState,
  INITIAL_DESKTOP_SHELL_STATE,
  reduceDesktopShell,
} from "@/lib/desktop-coordinator/reducer";
import { projectDesktopRoute, workspacePath } from "@/lib/desktop-coordinator/route";
import type {
  DesktopRouteParams,
  DesktopRouteProjection,
  DesktopUtility,
} from "@/lib/desktop-coordinator/types";
import { onOpenPersonPane } from "@/lib/person-pane";
import { onOpenScheduledPane } from "@/lib/scheduled-pane";
import { onOpenSettingsPane } from "@/lib/settings-pane";
import { installNativeMenuBridge } from "@/lib/desktop-shell";
import { setKeyboardRuntime } from "@/lib/keyboard/controller";
import { installKeyboardDispatcher } from "@/lib/keyboard/dispatcher";
import { helpEntries } from "@/lib/keyboard/registry";

function desktopProjection(
  pathname: string,
  params: DesktopRouteParams,
  previousWorkspace?: "messages" | "contacts",
): DesktopRouteProjection | null {
  const result = projectDesktopRoute(pathname, params, previousWorkspace);
  return result.ok ? result.value : null;
}

const HELP_ENTRIES = helpEntries();

function utilityForPerson(
  workspace: "messages" | "contacts",
  target: { readonly address: string; readonly name?: string },
  backGuid?: string,
): DesktopUtility {
  return {
    kind: "person",
    workspace,
    target,
    ...(backGuid ? { backGuid } : {}),
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
  const initialProjection = desktopProjection(pathname, params);
  const [state, dispatch] = useReducer(
    reduceDesktopShell,
    initialProjection ?? INITIAL_DESKTOP_SHELL_STATE,
    (initial) => ("kind" in initial ? createInitialDesktopShellState(initial) : initial),
  );
  const routeKey = `${pathname}:${JSON.stringify(params)}`;
  const projection = useMemo(
    () => desktopProjection(pathname, params, state.activeWorkspace),
    [routeKey, state.activeWorkspace],
  );
  const [messagesRail, setMessagesRail] = useState<MessagesRailState>({
    allChats: [],
    counts: null,
    state: "unresponded",
    type: "all",
  });
  const messagesActions = useRef<MessagesWorkspaceActions | null>(null);
  const activeWorkspace = projection?.workspace ?? state.activeWorkspace;
  const shellOwnsRoute = wide && projection !== null;

  useEffect(() => {
    if (projection === null) {
      if (wide) {
        dispatch({ type: "utility/closed" });
        dispatch({ type: "shadow/closed" });
      }
      return;
    }
    dispatch({ type: "route/committed", route: projection });
  }, [projection, wide]);

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
    const stopChatInfo = onOpenChatInfo((guid) => {
      dispatch({
        type: "utility/toggled",
        utility: { kind: "chat-info", workspace: "messages", guid },
      });
    });
    const stopPerson = onOpenPersonPane((target) => {
      dispatch({
        type: "utility/toggled",
        utility: utilityForPerson(
          activeWorkspace,
          { address: target.address, name: target.name },
          activeWorkspace === "messages" ? target.backGuid : undefined,
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
    return () => {
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
  const closeTopSurface = useCallback((): boolean => {
    if (helpOpen) {
      setHelpOpen(false);
      return true;
    }
    if (paletteOpen) {
      setPaletteOpen(false);
      return true;
    }
    if (state.routeOverlay) {
      if (router.canGoBack()) router.back();
      else router.replace(workspacePath(activeWorkspace));
      return true;
    }
    return false;
  }, [activeWorkspace, helpOpen, paletteOpen, state.routeOverlay]);
  const closeProjectedRoute = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace(workspacePath(activeWorkspace));
  }, [activeWorkspace]);
  const closeUtility = useCallback((): void => {
    dispatch({ type: "utility/closed" });
    if (projection?.kind === "utility") closeProjectedRoute();
  }, [closeProjectedRoute, projection?.kind]);

  useEffect(() => {
    if (!shellOwnsRoute || activeWorkspace !== "contacts") return;
    const closeContactsPanel = (): boolean => {
      if (closeTopSurface()) return true;
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
      laterSelected: () => undefined,
      markUnreadSelected: () => undefined,
      toggleDetails: () => undefined,
      focusListSearch: () => undefined,
      undoLast: () => undefined,
      escape: () => { closeContactsPanel(); },
      closePanel: closeContactsPanel,
    });
    return () => setKeyboardRuntime(null);
  }, [activeWorkspace, closeTopSurface, openHelp, openPalette, projection?.kind, shellOwnsRoute, state.utility]);

  const context = useMemo(
    () => ({
      activeWorkspace,
      closeTopSurface,
      closeUtility,
      dispatch,
      openHelp,
      openPalette,
      registerMessagesActions,
      reportMessagesRail,
      state,
    }),
    [activeWorkspace, closeTopSurface, closeUtility, openHelp, openPalette, registerMessagesActions, reportMessagesRail, state],
  );
  const utilityIsGlobal = state.utility?.kind === "scheduled" || state.utility?.kind === "settings";
  const utility =
    shellOwnsRoute && state.utility && (utilityIsGlobal || state.utility.workspace === activeWorkspace)
      ? state.utility
      : null;
  const utilityContent = utility?.kind === "chat-info" ? (
    <ChatInfoContent
      key={utility.guid}
      guid={utility.guid}
      showHeader
      onClose={closeUtility}
      onOpenPerson={(address, name) => {
        dispatch({
          type: "utility/toggled",
          utility: utilityForPerson("messages", { address, name }, utility.guid),
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
      backLabel={utility.backGuid ? "Details" : undefined}
      onBack={utility.backGuid ? () => {
        dispatch({
          type: "utility/toggled",
          utility: { kind: "chat-info", workspace: "messages", guid: utility.backGuid! },
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
    <DesktopUtilityPane open={utility !== null} onClose={closeUtility}>
      {utilityContent}
    </DesktopUtilityPane>
  );
  const closeRouteSurface = closeProjectedRoute;
  const routeOverlay = shellOwnsRoute ? state.routeOverlay : null;
  const routeOverlayContent = routeOverlay?.kind === "search" ? (
    <SearchContent
      initialQuery={routeOverlay.query}
      scopeChatGuid={routeOverlay.chatGuid}
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
        router.replace({ pathname: "/chat/[guid]", params: { guid: chat.guid, name: chat.displayName } });
      }}
    />
  ) : null;

  return (
    <DesktopShellContext.Provider value={context}>
      <View style={styles.root}>
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
            <TriageNavigationRail
              destination={activeWorkspace}
            />
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
                <ContactsWorkspace wide />
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
              backdropStyle={styles.paletteBackdrop}
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
                    filters: { state: next, type: messagesRail.type },
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
              onClose={() => setHelpOpen(false)}
              backdropStyle={styles.paletteBackdrop}
              cardStyle={[styles.helpCard, { borderColor: theme.cardBorder }]}
            >
              <Text style={[styles.helpTitle, { color: theme.text }]}>Keyboard Shortcuts</Text>
              {HELP_ENTRIES.map(({ title, keys }) => (
                <View key={title} style={styles.helpRow}>
                  <Text style={[styles.helpLabel, { color: theme.textSecondary }]}>{title}</Text>
                  <View style={styles.helpKeys}>
                    {keys.map((key) => (
                      <View
                        key={key}
                        style={[styles.kbd, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}
                      >
                        <Text style={[styles.kbdText, { color: theme.text }]}>{key}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
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
  helpKeys: {
    flexDirection: "row",
    gap: 5,
  },
  helpLabel: {
    flex: 1,
    fontSize: Type.secondary,
  },
  helpRow: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 10,
  },
  helpTitle: {
    fontSize: Type.title,
    fontWeight: "700",
    marginBottom: 14,
  },
  kbd: {
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  kbdText: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  paletteBackdrop: {
    backgroundColor: "rgba(18,18,22,0.34)",
    justifyContent: "flex-start",
    paddingTop: 72,
  },
  paletteCard: {
    borderRadius: 16,
    maxHeight: "80%",
    maxWidth: 720,
    overflow: "hidden",
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
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  workspace: {
    ...StyleSheet.absoluteFillObject,
  },
  workspaceHost: {
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
});
