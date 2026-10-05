import { Platform, type PressableStateCallbackType, type ViewStyle } from "react-native";

import { Colors } from "@/constants/tokens";

/** react-native-web adds `hovered` and `focused`; native reports neither. */
export type InteractionState = PressableStateCallbackType & {
  readonly hovered?: boolean;
  readonly focused?: boolean;
};

export type Scheme = "light" | "dark";
export type ThemeColors = (typeof Colors)[Scheme];

let keyboardModality = false;
if (Platform.OS === "web" && typeof globalThis.document !== "undefined") {
  const doc = globalThis.document;
  doc.addEventListener("keydown", (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboardModality = true;
  }, true);
  doc.addEventListener("pointerdown", () => {
    keyboardModality = false;
  }, true);
}

/**
 * RNW reports `focused` for pointer focus as well, so the ring follows the
 * `:focus-visible` rule instead: only while the keyboard moved focus.
 */
export function focusVisible(state: InteractionState): boolean {
  return state.focused === true && keyboardModality;
}

export function focusRing(theme: ThemeColors): ViewStyle {
  // outline* are web-only style keys RN's types do not list.
  return { outlineColor: theme.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: 2 } as ViewStyle;
}

/** Idle fill, then hover raises one step and press raises two. */
export function stepFill(theme: ThemeColors, state: InteractionState, rest: string): string {
  if (state.pressed) return theme.rowSelected;
  if (state.hovered) return theme.rowHover;
  return rest;
}
