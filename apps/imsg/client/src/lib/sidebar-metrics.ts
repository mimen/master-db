export const SIDEBAR_WIDTH_DEFAULT = 352;
export const SIDEBAR_WIDTH_MIN = 280;
export const SIDEBAR_WIDTH_MAX = 560;

/** App-name row. Lights sit at y:20 (12px), so the row is 52 to center them. */
export const SIDEBAR_TITLE_HEIGHT = 52;
/** Sticky search + new-message under the title on wide/desktop. */
export const SIDEBAR_TOOLBAR_HEIGHT = 44;
/** Messages/Contacts switcher row under search. */
export const SIDEBAR_NAV_HEIGHT = 56;
/** Settings footer on wide/desktop. */
export const SIDEBAR_FOOTER_HEIGHT = 64;
/** Scroll-edge fade length. */
export const SIDEBAR_SCROLL_FADE = 28;

/** Fixed top chrome: title+search+nav on wide, title-only (search inline) on mobile. */
export function sidebarChromeHeight(wide: boolean): number {
  return wide
    ? SIDEBAR_TITLE_HEIGHT + SIDEBAR_TOOLBAR_HEIGHT + SIDEBAR_NAV_HEIGHT
    : SIDEBAR_TITLE_HEIGHT;
}

export function sidebarFooterHeight(wide: boolean): number {
  return wide ? SIDEBAR_FOOTER_HEIGHT : 0;
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}
