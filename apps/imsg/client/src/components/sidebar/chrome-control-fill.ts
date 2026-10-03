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
