import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@shared/types";
import { createContext, useContext, useSyncExternalStore } from "react";

import { INITIAL_DESKTOP_SHELL_STATE, reduceDesktopShell } from "@/lib/desktop-coordinator/reducer";
import type { DesktopShellAction, DesktopShellState } from "@/lib/desktop-coordinator/types";

export interface MessagesRailState {
  readonly allChats: readonly ChatSummary[];
  readonly counts: StateCounts | null;
  readonly state: StateFilter;
  readonly type: TypeFilter;
}

export interface MessagesWorkspaceActions {
  readonly applyState: (state: StateFilter) => void;
  readonly applyType: (type: TypeFilter) => void;
  readonly clearSelection: () => void;
  readonly openChat: (chat: ChatSummary) => void;
  readonly refresh: () => void;
}

/** The shell's state outside React, so each reader re-renders only when the slice it selects changes. */
export interface DesktopShellStore {
  readonly getState: () => DesktopShellState;
  readonly dispatch: (action: DesktopShellAction) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createDesktopShellStore(initial: DesktopShellState): DesktopShellStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = reduceDesktopShell(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Every member is stable for the provider's lifetime, so the context never re-renders a reader. */
export interface DesktopShellContextValue {
  readonly store: DesktopShellStore;
  readonly closeTopSurface: () => boolean;
  readonly closeUtility: () => void;
  readonly dispatch: (action: DesktopShellAction) => void;
  readonly openHelp: () => void;
  readonly openPalette: (compose?: boolean) => void;
  readonly registerMessagesActions: (actions: MessagesWorkspaceActions | null) => void;
  readonly reportMessagesRail: (state: MessagesRailState) => void;
}

export const DesktopShellContext = createContext<DesktopShellContextValue | null>(null);

export function useDesktopShellContext(): DesktopShellContextValue {
  const value = useContext(DesktopShellContext);
  if (value === null) {
    throw new Error("Desktop workspace must render inside DesktopShellProvider");
  }
  return value;
}

const noSubscription = (): (() => void) => () => undefined;

/**
 * A slice of the shell state; outside the provider, the slice of the initial state. The selector must
 * return a primitive or a piece of the state as is, so an unchanged slice compares equal.
 */
export function useDesktopShellState<T>(select: (state: DesktopShellState) => T): T {
  const store = useContext(DesktopShellContext)?.store;
  const snapshot = (): T => select(store ? store.getState() : INITIAL_DESKTOP_SHELL_STATE);
  return useSyncExternalStore(store ? store.subscribe : noSubscription, snapshot, snapshot);
}
