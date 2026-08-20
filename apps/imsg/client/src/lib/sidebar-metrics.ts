export const SIDEBAR_WIDTH_DEFAULT = 380;
export const SIDEBAR_WIDTH_MIN = 280;
export const SIDEBAR_WIDTH_MAX = 560;

/** App-name row. Matches overlay traffic-light centering (lights at y: 20). */
export const SIDEBAR_TITLE_HEIGHT = 52;
/** Sticky search + actions under the title on wide/desktop. */
export const SIDEBAR_TOOLBAR_HEIGHT = 44;

/** Fixed chrome height: title+toolbar on wide, title-only (search inline) on mobile. */
export function sidebarChromeHeight(wide: boolean): number {
  return wide ? SIDEBAR_TITLE_HEIGHT + SIDEBAR_TOOLBAR_HEIGHT : SIDEBAR_TITLE_HEIGHT;
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}
