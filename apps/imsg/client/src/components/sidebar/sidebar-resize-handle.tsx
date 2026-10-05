import { useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";


const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface SidebarResizeHandleProps {
  readonly width: number;
  readonly onResize: (next: number) => void;
}

/** Drag the list/detail divider to resize the sidebar. The 6px hit area is invisible; the pane border draws the line. */
export function SidebarResizeHandle({ width, onResize }: SidebarResizeHandleProps): React.JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: { nativeEvent: { pageX: number } }): void => {
    drag.current = { startX: event.nativeEvent.pageX, startWidth: width };
    const move = (e: PointerEvent): void => {
      const origin = drag.current;
      if (!origin) return;
      onResize(origin.startWidth + (e.pageX - origin.startX));
    };
    if (typeof window === "undefined") return;
    // The pointer crosses page text during a drag; without this the drag also selects it.
    const body = document.body.style;
    const priorSelect = body.userSelect;
    body.userSelect = "none";
    const up = (): void => {
      drag.current = null;
      body.userSelect = priorSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
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
        Platform.OS === "web"
          ? ({ cursor: "col-resize", userSelect: "none" } as object)
          : null,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // Inside the edge: the list pane clips overflow, so a handle hanging past it is half unreachable.
  handle: {
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 6,
    zIndex: 20,
  },
});
