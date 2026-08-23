import type { ChatSummary, StateCounts, StateFilter, TypeFilter } from "@shared/types";
import type { Dispatch } from "react";
import { createContext, useContext } from "react";

import type {
  DesktopShellAction,
  DesktopShellState,
  DesktopWorkspaceId,
} from "@/lib/desktop-coordinator/types";

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

export interface DesktopShellContextValue {
  readonly activeWorkspace: DesktopWorkspaceId;
  readonly closeTopSurface: () => boolean;
  readonly closeUtility: () => void;
  readonly dispatch: Dispatch<DesktopShellAction>;
  readonly openHelp: () => void;
  readonly openPalette: (compose?: boolean) => void;
  readonly registerMessagesActions: (actions: MessagesWorkspaceActions | null) => void;
  readonly reportMessagesRail: (state: MessagesRailState) => void;
  readonly state: DesktopShellState;
}

export const DesktopShellContext = createContext<DesktopShellContextValue | null>(null);

export function useDesktopShellContext(): DesktopShellContextValue {
  const value = useContext(DesktopShellContext);
  if (value === null) {
    throw new Error("Desktop workspace must render inside DesktopShellProvider");
  }
  return value;
}
