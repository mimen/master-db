import { Platform } from "react-native";

import { isDesktopShell } from "@/lib/desktop-shell";

/**
 * Global web CSS enforced from the BUNDLE, not just the HTML shell — a stale
 * cached PWA shell (the recurring Safari home-screen gremlin) still gets these
 * the moment the JS loads. Policy: no focus outlines anywhere, ever, and 16px
 * inputs so iOS Safari never auto-zooms on focus.
 */
export function ensureGlobalWebCss(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const shell = isDesktopShell();
  if (document.getElementById("imsg-global-css")) {
    // Shell state can resolve after the first paint (the Tauri flag lands via
    // initialization script); keep the corner radius in sync if it changed.
    const existing = document.getElementById("imsg-shell-radius");
    if (shell !== Boolean(existing)) syncShellRadius(shell, existing);
    return;
  }
  const style = document.createElement("style");
  style.id = "imsg-global-css";
  style.textContent =
    "*:focus,*:focus-visible{outline:none!important;box-shadow:none!important}" +
    "input,textarea,select{font-size:16px!important}" +
    "@media (min-width:768px){input,textarea,select{font-size:13px!important}}" +
    "[data-tauri-drag-region]{-webkit-app-region:drag;app-region:drag}" +
    '[data-tauri-drag-region="false"],button,a,input,textarea,[role="button"]{-webkit-app-region:no-drag;app-region:no-drag;cursor:pointer}';
  document.head.appendChild(style);
  if (shell) syncShellRadius(true, null);
}

/**
 * The Tauri window is transparent + undecorated, so the rounded corners come
 * from the page itself: clip the root scroller to the macOS corner radius and
 * give the html/body a clear background so the window's transparency shows
 * outside the curve. No-op in a plain browser.
 */
function syncShellRadius(shell: boolean, existing: HTMLElement | null): void {
  if (typeof document === "undefined") return;
  const id = "imsg-shell-radius";
  if (!shell) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent =
    "html,body{background:transparent!important}" +
    ":root{--imsg-window-radius:10px}" +
    "body{border-radius:var(--imsg-window-radius);overflow:hidden}";
  document.head.appendChild(style);
}
