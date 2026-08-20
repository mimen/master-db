export const SIDEBAR_WIDTH_DEFAULT = 380;
export const SIDEBAR_WIDTH_MIN = 280;
export const SIDEBAR_WIDTH_MAX = 560;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}
