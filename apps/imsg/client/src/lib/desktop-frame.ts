import type { ViewStyle } from "react-native";

export const AUX_PANE_WIDTH = 312;

export interface FrameTheme {
  readonly background: string;
  readonly divider: string;
  readonly desk?: string;
}

export interface DesktopFrameStyles {
  readonly split: ViewStyle;
  readonly pane: ViewStyle;
  readonly listPane: ViewStyle;
  readonly detailPane: ViewStyle;
  readonly auxPane: ViewStyle;
}

/**
 * Wide/desktop split: floating panes on the desk. Gutters live on DesktopSplit.
 * Used for both the PWA at desktop width and the Tauri shell.
 */
export function desktopFrame(theme: FrameTheme, listWidth = 352): DesktopFrameStyles {
  return {
    split: {
      flex: 1,
      flexDirection: "row",
      backgroundColor: theme.desk ?? theme.background,
    },
    pane: {
      backgroundColor: "transparent",
      borderRadius: 12,
      overflow: "hidden",
    },
    listPane: {
      flexBasis: listWidth,
      flexGrow: 0,
      flexShrink: 0,
      width: listWidth,
    },
    detailPane: {
      backgroundColor: theme.background,
      flex: 1,
    },
    auxPane: {
      flexBasis: AUX_PANE_WIDTH,
      flexGrow: 0,
      flexShrink: 0,
      width: AUX_PANE_WIDTH,
    },
  };
}
