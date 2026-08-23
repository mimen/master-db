import type {
  DesktopRouteProjection,
  DesktopShellAction,
  DesktopShellState,
  DesktopUtility,
} from "./types";

const DEFAULT_FILTERS = {
  state: "unresponded",
  type: "all",
} as const;

const BASE_DESKTOP_SHELL_STATE: DesktopShellState = {
  activeWorkspace: "messages",
  messages: {
    filters: DEFAULT_FILTERS,
    selection: null,
  },
  contacts: {
    selection: null,
  },
  utility: null,
  routeOverlay: null,
  transientOverlay: null,
  shadow: null,
};

function sameUtility(left: DesktopUtility, right: DesktopUtility): boolean {
  if (left.kind !== right.kind || left.workspace !== right.workspace) return false;
  switch (left.kind) {
    case "chat-info":
      return right.kind === "chat-info" && left.guid === right.guid;
    case "person":
      return (
        right.kind === "person" &&
        left.target.address === right.target.address &&
        left.backGuid === right.backGuid
      );
    case "scheduled":
    case "settings":
      return true;
  }
}

function commitRoute(
  state: DesktopShellState,
  route: DesktopRouteProjection,
): DesktopShellState {
  const workspaceChanged = route.workspace !== state.activeWorkspace;
  const base: DesktopShellState = {
    ...state,
    activeWorkspace: route.workspace,
    utility: null,
    routeOverlay: null,
    transientOverlay: workspaceChanged ? null : state.transientOverlay,
    shadow: workspaceChanged ? null : state.shadow,
  };

  switch (route.kind) {
    case "workspace":
      return base;
    case "chat":
      return {
        ...base,
        messages: { ...base.messages, selection: route.selection },
        shadow:
          base.shadow?.chatGuid === route.selection.guid
            ? base.shadow
            : null,
      };
    case "person":
      return {
        ...base,
        contacts: { selection: route.selection },
      };
    case "utility":
      return {
        ...base,
        messages: route.chatSelection
          ? { ...base.messages, selection: route.chatSelection }
          : base.messages,
        utility: route.utility,
        shadow: null,
      };
    case "route-overlay":
      return {
        ...base,
        routeOverlay: route.overlay,
      };
  }
}

export const INITIAL_DESKTOP_SHELL_STATE: DesktopShellState = BASE_DESKTOP_SHELL_STATE;

export function createInitialDesktopShellState(
  route: DesktopRouteProjection,
): DesktopShellState {
  return commitRoute(BASE_DESKTOP_SHELL_STATE, route);
}

export function reduceDesktopShell(
  state: DesktopShellState,
  action: DesktopShellAction,
): DesktopShellState {
  switch (action.type) {
    case "route/committed":
      return commitRoute(state, action.route);
    case "messages/filters-changed":
      return {
        ...state,
        messages: { ...state.messages, filters: action.filters },
      };
    case "messages/chat-selected":
      return {
        ...state,
        messages: { ...state.messages, selection: action.selection },
        shadow:
          state.shadow?.chatGuid === action.selection.guid
            ? state.shadow
            : null,
      };
    case "messages/chat-cleared":
      return {
        ...state,
        messages: { ...state.messages, selection: null },
        utility:
          state.utility?.kind === "chat-info" ||
          (state.utility?.kind === "person" && state.utility.workspace === "messages")
            ? null
            : state.utility,
        shadow: null,
      };
    case "contacts/person-selected":
      return {
        ...state,
        contacts: { selection: action.selection },
      };
    case "utility/toggled":
      return sameUtility(state.utility ?? action.utility, action.utility) && state.utility !== null
        ? { ...state, utility: null }
        : { ...state, utility: action.utility, shadow: null };
    case "utility/closed":
      return state.utility === null ? state : { ...state, utility: null };
    case "route-overlay/closed":
      return state.routeOverlay === null ? state : { ...state, routeOverlay: null };
    case "overlay/opened":
      return { ...state, transientOverlay: action.overlay };
    case "overlay/closed":
      return state.transientOverlay?.kind === action.kind
        ? { ...state, transientOverlay: null }
        : state;
    case "shadow/toggled":
      return state.shadow?.chatGuid === action.chatGuid
        ? { ...state, shadow: null }
        : {
            ...state,
            utility: null,
            shadow: { chatGuid: action.chatGuid },
          };
    case "shadow/closed":
      return state.shadow === null ? state : { ...state, shadow: null };
  }
}
