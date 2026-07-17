import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Desktop-web right-click support: attaches a DOM contextmenu listener to the
 * ref'd RN view (which is a DOM node on web) and invokes the handler instead
 * of the browser menu. No-op on native.
 */
export function useWebContextMenu<T>(handler: () => void) {
  const ref = useRef<T>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onContextMenu = (event: Event) => {
      event.preventDefault();
      handlerRef.current();
    };
    node.addEventListener("contextmenu", onContextMenu);
    return () => node.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return ref;
}
