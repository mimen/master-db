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
const modalityListeners = new Set<() => void>();
function setModality(keyboard: boolean): void {
  if (keyboardModality === keyboard) return;
  keyboardModality = keyboard;
  for (const listener of modalityListeners) listener();
}
if (Platform.OS === "web" && typeof globalThis.document !== "undefined") {
  const doc = globalThis.document;
  doc.addEventListener("keydown", (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) setModality(true);
  }, true);
  doc.addEventListener("pointerdown", () => setModality(false), true);
}

/** True while the keyboard, not the pointer, last moved things: the `:focus-visible` rule. */
export const keyboardDriven = (): boolean => keyboardModality;

export function subscribeKeyboardDriven(listener: () => void): () => void {
  modalityListeners.add(listener);
  return () => void modalityListeners.delete(listener);
}

/**
 * RNW reports `focused` for pointer focus as well, so the ring follows the
 * `:focus-visible` rule instead: only while the keyboard moved focus.
 */
export function focusVisible(state: InteractionState): boolean {
  return state.focused === true && keyboardModality;
}

/**
 * Remounts a Pressable when it is disabled or re-enabled. A focused web button that turns disabled
 * loses focus during React's commit, while React DOM ignores events, so the blur never reaches
 * RNW's Pressable; its stale `focused` would draw the ring once the button is enabled again.
 */
export const pressableKey = (disabled: boolean | undefined) => (disabled ? "disabled" : "enabled");

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
