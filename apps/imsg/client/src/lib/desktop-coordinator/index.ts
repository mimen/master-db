export {
  calculatePaneAdmission,
  DESKTOP_DETAIL_MIN_WIDTH,
  DESKTOP_RAIL_WIDTH,
  DESKTOP_SIDE_PANE_WIDTH,
  type PaneAdmission,
  type PaneAdmissionInput,
} from "./pane-admission";
export {
  desktopSurfaceCloseTarget,
  projectDesktopRoute,
  workspacePath,
} from "./route";
export {
  createInitialDesktopShellState,
  INITIAL_DESKTOP_SHELL_STATE,
  reduceDesktopShell,
} from "./reducer";
export type {
  DesktopChatSelection,
  DesktopPersonSelection,
  DesktopRouteError,
  DesktopRouteOverlay,
  DesktopRouteParams,
  DesktopRouteProjection,
  DesktopShellAction,
  DesktopShellState,
  DesktopTransientOverlay,
  DesktopUtility,
  DesktopWorkspaceId,
  DesktopWorkspaceProvenance,
  InboxFilters,
  Result,
  SelectionIntent,
} from "./types";
