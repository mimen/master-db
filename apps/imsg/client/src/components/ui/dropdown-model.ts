/** What a key press inside an open dropdown menu does. */
export type MenuKeyResult =
  | { readonly kind: "move"; readonly index: number }
  | { readonly kind: "select"; readonly index: number }
  | { readonly kind: "close" };

/** Arrow keys clamp at the ends like a native menu; Home and End jump; Tab closes without choosing. */
export function menuKey(key: string, index: number, count: number): MenuKeyResult | null {
  if (count === 0) return key === "Escape" || key === "Tab" ? { kind: "close" } : null;
  switch (key) {
    case "ArrowDown":
      return { kind: "move", index: Math.min(index + 1, count - 1) };
    case "ArrowUp":
      return { kind: "move", index: Math.max(index - 1, 0) };
    case "Home":
      return { kind: "move", index: 0 };
    case "End":
      return { kind: "move", index: count - 1 };
    case "Enter":
    case " ":
      return { kind: "select", index };
    case "Escape":
    case "Tab":
      return { kind: "close" };
    default:
      return null;
  }
}

/** Opening highlights the current value, or the first option when nothing matches. */
export function initialIndex<T>(values: readonly T[], current: T): number {
  return Math.max(values.indexOf(current), 0);
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const GAP = 4;
const EDGE = 8;

/**
 * Places the menu under its field, trailing edges aligned when the menu is wider,
 * and flips it above when it would run off the bottom and there is more room above.
 */
export function placeMenu(
  field: Rect,
  menu: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  const right = field.x + field.width;
  const left = Math.max(EDGE, Math.min(right - menu.width, viewport.width - menu.width - EDGE));
  const below = field.y + field.height + GAP;
  const roomBelow = viewport.height - EDGE - below;
  const roomAbove = field.y - GAP - EDGE;
  if (menu.height > roomBelow && roomAbove > roomBelow) {
    return { left, top: Math.max(EDGE, field.y - GAP - menu.height) };
  }
  return { left, top: below };
}
