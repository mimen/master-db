import { HOVER_DIM, PRESS_DIM } from "@/constants/theme";

export interface ChromeFillTheme {
  readonly backgroundElement: string;
  readonly backgroundSelected: string;
}

export interface ChromeFillState {
  readonly hovered: boolean;
  readonly pressed: boolean;
}

/** Idle: no fill. Hover: raised chip. Press: one step darker. */
export function chromeControlFill(
  theme: ChromeFillTheme,
  state: ChromeFillState,
): { backgroundColor: string } | undefined {
  if (state.pressed) return { backgroundColor: theme.backgroundSelected };
  if (state.hovered) return { backgroundColor: theme.backgroundElement };
  return undefined;
}

export interface FilterChipTheme extends ChromeFillTheme {
  readonly text: string;
}

export interface FilterChipState extends ChromeFillState {
  readonly selected: boolean;
}

/** Inverted when selected; otherwise element → selected on hover/press. */
export function filterChipFill(
  theme: FilterChipTheme,
  state: FilterChipState,
): { backgroundColor: string; opacity?: number } {
  if (state.selected) {
    return { backgroundColor: theme.text, opacity: state.pressed ? PRESS_DIM : state.hovered ? HOVER_DIM : 1 };
  }
  if (state.pressed || state.hovered) return { backgroundColor: theme.backgroundSelected };
  return { backgroundColor: theme.backgroundElement };
}
