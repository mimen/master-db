import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Desktop-web right-click support: attaches a DOM contextmenu listener to the
 * ref'd RN view (which is a DOM node on web) and invokes the handler instead
 * of the browser menu. No-op on native.
 */
export interface MenuAnchor {
  x: number;
  y: number;
}

export function useWebContextMenu<T>(handler: (anchor?: MenuAnchor) => void) {
  const ref = useRef<T>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onContextMenu = (event: Event) => {
      event.preventDefault();
      const mouse = event as MouseEvent;
      handlerRef.current({ x: mouse.clientX, y: mouse.clientY });
    };
    node.addEventListener("contextmenu", onContextMenu);
    return () => node.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return ref;
}
