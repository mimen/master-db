import { Platform } from "react-native";

/**
 * Global web CSS enforced from the BUNDLE, not just the HTML shell — a stale
 * cached PWA shell (the recurring Safari home-screen gremlin) still gets these
 * the moment the JS loads. Policy: no focus outlines anywhere, ever, and 16px
 * inputs so iOS Safari never auto-zooms on focus.
 */
export function ensureGlobalWebCss(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (document.getElementById("imsg-global-css")) return;
  const style = document.createElement("style");
  style.id = "imsg-global-css";
  style.textContent =
    "*:focus,*:focus-visible{outline:none!important;box-shadow:none!important}" +
    "input,textarea,select{font-size:16px!important}" +
    "@media (min-width:768px){input,textarea,select{font-size:13px!important}}" +
    "[data-tauri-drag-region]{-webkit-app-region:drag;app-region:drag}" +
    '[data-tauri-drag-region="false"],button,a,input,textarea,[role="button"]{-webkit-app-region:no-drag;app-region:no-drag;cursor:pointer}';
  document.head.appendChild(style);
}
