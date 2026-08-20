import type { ViewStyle } from "react-native";

import { isDesktopShell } from "./desktop-shell";

// Keep in lockstep with Radii.card / CardShadow in constants/theme.ts.
const CARD_RADIUS = 14;
const CARD_SHADOW = { shadowColor: "#000" } as const;
/** 1px divider — RN's hairlineWidth isn't available in bun tests of this module. */
const HAIRLINE = 1;

export interface FrameTheme {
  readonly background: string;
  readonly desk: string;
  readonly cardBorder: string;
  readonly divider: string;
}

export interface DesktopFrameStyles {
  readonly shell: boolean;
  readonly split: ViewStyle;
  readonly pane: ViewStyle;
  readonly listPane: ViewStyle;
  readonly detailPane: ViewStyle;
}

/** Shared Messages/Contacts split: floating cards on the web; edge-to-edge in Tauri. */
export function desktopFrame(
  theme: FrameTheme,
  shell: boolean = isDesktopShell(),
): DesktopFrameStyles {
  return {
    shell,
    split: {
      flex: 1,
      flexDirection: "row",
      gap: shell ? 0 : 10,
      padding: shell ? 0 : 10,
      backgroundColor: shell ? theme.background : theme.desk,
    },
    pane: shell
      ? {
          backgroundColor: theme.background,
          overflow: "hidden",
        }
      : {
          backgroundColor: theme.background,
          borderColor: theme.cardBorder,
          borderRadius: CARD_RADIUS,
          borderTopColor: "rgba(255,255,255,0.14)",
          borderWidth: HAIRLINE,
          overflow: "hidden",
          ...CARD_SHADOW,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.32,
          shadowRadius: 22,
        },
    listPane: {
      flexBasis: 380,
      flexGrow: 0,
      flexShrink: 0,
      width: 380,
      ...(shell
        ? {
            borderRightColor: theme.divider,
            borderRightWidth: HAIRLINE,
          }
        : {}),
    },
    detailPane: {
      flex: 1,
    },
  };
}
