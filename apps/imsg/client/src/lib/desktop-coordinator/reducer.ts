import { DEFAULT_INBOX_FILTERS } from "@/lib/inbox-model";

import type {
  DesktopChatSelection,
  DesktopRouteProjection,
  DesktopShellAction,
  DesktopShellState,
  DesktopUtility,
} from "./types";

const DEFAULT_FILTERS = {
  state: "today",
  type: DEFAULT_INBOX_FILTERS.type,
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
};

function sameUtility(left: DesktopUtility, right: DesktopUtility): boolean {
  if (left.kind !== right.kind || left.workspace !== right.workspace) return false;
  switch (left.kind) {
    case "chat-info":
      return right.kind === "chat-info" && left.conversationId === right.conversationId;
    case "person":
      return (
        right.kind === "person" &&
        left.target.address === right.target.address &&
        left.backConversation === right.backConversation
      );
    case "scheduled":
    case "settings":
    case "agent":
      return true;
  }
}

function commitRoute(
  state: DesktopShellState,
  route: DesktopRouteProjection,
): DesktopShellState {
  const workspaceChanged = route.workspace !== state.activeWorkspace;
  const keptUtility =
    state.utility?.kind === "scheduled" || state.utility?.kind === "settings"
      ? { ...state.utility, workspace: route.workspace }
      : state.utility?.kind === "agent" && route.workspace === state.utility.workspace
        ? state.utility
        : null;
  const base: DesktopShellState = {
    ...state,
    activeWorkspace: route.workspace,
    utility: keptUtility,
    routeOverlay: null,
    transientOverlay: workspaceChanged ? null : state.transientOverlay,
  };

  switch (route.kind) {
    case "workspace":
      return base;
    case "chat":
      return {
        ...base,
        messages: { ...base.messages, selection: route.selection },
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
      };
    case "route-overlay":
      return {
        ...base,
        routeOverlay: route.overlay,
      };
  }
}

function sameChatSelection(left: DesktopChatSelection | null, right: DesktopChatSelection | null): boolean {
  return left === right || (left !== null && right !== null &&
    left.conversationId === right.conversationId &&
    left.jumpTarget?.guid === right.jumpTarget?.guid &&
    left.jumpTarget?.dateCreated === right.jumpTarget?.dateCreated);
}

const sameValue = (left: unknown, right: unknown): boolean => left === right || JSON.stringify(left) === JSON.stringify(right);

/**
 * A route commit that changes nothing keeps the state, slice by slice, so its readers do not
 * re-render. A conversation opened by a click is selected first and its route commits after; the
 * clicked selection, which also carries the name and intent, stays.
 */
function keepUnchanged(state: DesktopShellState, next: DesktopShellState): DesktopShellState {
  const messages = sameChatSelection(state.messages.selection, next.messages.selection) &&
    sameValue(state.messages.filters, next.messages.filters) ? state.messages : next.messages;
  const contacts = sameValue(state.contacts, next.contacts) ? state.contacts : next.contacts;
  const utility = sameValue(state.utility, next.utility) ? state.utility : next.utility;
  const routeOverlay = sameValue(state.routeOverlay, next.routeOverlay) ? state.routeOverlay : next.routeOverlay;
  if (messages === state.messages && contacts === state.contacts && utility === state.utility &&
    routeOverlay === state.routeOverlay && next.transientOverlay === state.transientOverlay &&
    next.activeWorkspace === state.activeWorkspace) return state;
  return { ...next, messages, contacts, utility, routeOverlay };
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
      return keepUnchanged(state, commitRoute(state, action.route));
    case "messages/filters-changed":
      return {
        ...state,
        messages: { ...state.messages, filters: action.filters },
      };
    case "messages/chat-selected":
      return {
        ...state,
        messages: { ...state.messages, selection: action.selection },
      };
    case "messages/chat-settled":
      return {
        ...state,
        messages: { ...state.messages, selection: null },
        utility:
          state.utility?.kind === "chat-info" ||
          state.utility?.kind === "agent" ||
          (state.utility?.kind === "person" && state.utility.workspace === "messages")
            ? null
            : state.utility,
      };
    case "contacts/person-selected":
      return {
        ...state,
        contacts: { selection: action.selection },
      };
    case "utility/toggled":
      return sameUtility(state.utility ?? action.utility, action.utility) && state.utility !== null
        ? { ...state, utility: null }
        : { ...state, utility: action.utility };
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
  }
}
