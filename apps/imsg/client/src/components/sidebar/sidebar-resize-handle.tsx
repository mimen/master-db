import { useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface SidebarResizeHandleProps {
  readonly width: number;
  readonly onResize: (next: number) => void;
}

/** Drag the list/detail hairline to resize the sidebar. */
export function SidebarResizeHandle({ width, onResize }: SidebarResizeHandleProps): React.JSX.Element {
  const theme = useTheme();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: { nativeEvent: { pageX: number } }): void => {
    drag.current = { startX: event.nativeEvent.pageX, startWidth: width };
    const move = (e: PointerEvent): void => {
      const origin = drag.current;
      if (!origin) return;
      onResize(origin.startWidth + (e.pageX - origin.startX));
    };
    const up = (): void => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    if (typeof window === "undefined") return;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Resize sidebar"
      {...NO_DRAG}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => onPointerDown(e)}
      style={[
        styles.handle,
        { backgroundColor: theme.divider },
        Platform.OS === "web"
          ? ({ cursor: "col-resize", userSelect: "none" } as object)
          : null,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  handle: {
    bottom: 0,
    position: "absolute",
    right: -3,
    top: 0,
    width: 6,
    zIndex: 20,
  },
});
