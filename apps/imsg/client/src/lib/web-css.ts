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
    "input,textarea,select{font-size:16px!important}";
  document.head.appendChild(style);
}
