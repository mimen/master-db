import { AUX_PANE_WIDTH } from "../desktop-frame";

export const DESKTOP_RAIL_WIDTH = 64;
export const DESKTOP_DETAIL_MIN_WIDTH = 420;
export const DESKTOP_SIDE_PANE_WIDTH = AUX_PANE_WIDTH;

export interface PaneAdmissionInput {
  readonly windowWidth: number;
  /** Actual current sidebar width, excluding the fixed desktop rail. */
  readonly sidebarWidth: number;
  readonly sidePaneWidth?: number;
}

export interface PaneAdmission {
  /** Width available to detail before a side pane is admitted. */
  readonly detailBudget: number;
  readonly spareAfterMinimumDetail: number;
  readonly sidePaneWidth: number;
  readonly sidePane: "pane" | "overlay";
}

/**
 * A side pane is admitted only when the detail column keeps its 420px minimum
 * after subtracting the 64px rail, actual sidebar, and side-pane width.
 */
export function calculatePaneAdmission(input: PaneAdmissionInput): PaneAdmission {
  const sidePaneWidth = input.sidePaneWidth ?? DESKTOP_SIDE_PANE_WIDTH;
  const detailBudget = input.windowWidth - DESKTOP_RAIL_WIDTH - input.sidebarWidth;
  const spareAfterMinimumDetail = detailBudget - DESKTOP_DETAIL_MIN_WIDTH;
  return {
    detailBudget,
    spareAfterMinimumDetail,
    sidePaneWidth,
    sidePane: spareAfterMinimumDetail >= sidePaneWidth ? "pane" : "overlay",
  };
}
