import type { ViewStyle } from "react-native";

/** 1px divider — RN's hairlineWidth isn't available in bun tests of this module. */
const HAIRLINE = 1;

export interface FrameTheme {
  readonly background: string;
  readonly divider: string;
}

export interface DesktopFrameStyles {
  readonly split: ViewStyle;
  readonly pane: ViewStyle;
  readonly listPane: ViewStyle;
  readonly detailPane: ViewStyle;
  readonly auxPane: ViewStyle;
}

/**
 * Wide/desktop split: flush to the window, panes separated by a hairline.
 * Used for both the PWA at desktop width and the Tauri shell.
 */
export function desktopFrame(theme: FrameTheme): DesktopFrameStyles {
  return {
    split: {
      flex: 1,
      flexDirection: "row",
      backgroundColor: theme.background,
    },
    pane: {
      backgroundColor: theme.background,
      overflow: "hidden",
    },
    listPane: {
      flexBasis: 380,
      flexGrow: 0,
      flexShrink: 0,
      width: 380,
      borderRightColor: theme.divider,
      borderRightWidth: HAIRLINE,
    },
    detailPane: {
      flex: 1,
    },
    auxPane: {
      flexBasis: 330,
      flexGrow: 0,
      flexShrink: 0,
      width: 330,
      borderLeftColor: theme.divider,
      borderLeftWidth: HAIRLINE,
    },
  };
}
