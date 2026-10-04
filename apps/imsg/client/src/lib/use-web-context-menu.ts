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
      // A keyboard-raised contextmenu (Menu key) reports 0,0; anchor it to the element instead.
      handlerRef.current(mouse.clientX || mouse.clientY ? { x: mouse.clientX, y: mouse.clientY } : anchorOf(node));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== node) return;
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        handlerRef.current(anchorOf(node));
      }
    };
    // Focusable so the menu is reachable without a pointer.
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "0");
    node.addEventListener("contextmenu", onContextMenu);
    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("contextmenu", onContextMenu);
      node.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return ref;
}

function anchorOf(node: HTMLElement): MenuAnchor {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}
