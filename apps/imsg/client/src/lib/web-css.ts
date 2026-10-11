import { Platform } from "react-native";

import { Colors } from "@/constants/theme";

/**
 * Global web CSS enforced from the BUNDLE, not just the HTML shell, so a stale
 * cached PWA shell still gets these the moment the JS loads. Keyboard focus
 * draws one persimmon ring; text fields already show a caret, so they keep none,
 * and full-bleed list rows inset theirs so the scroller does not clip it.
 * Inputs are 16px so iOS Safari never auto-zooms on focus.
 */
export const GLOBAL_WEB_CSS =
  `:focus{outline:none}` +
  `:focus-visible{outline:2px solid ${Colors.light.focusRing};outline-offset:2px}` +
  `@media (prefers-color-scheme:dark){:focus-visible{outline-color:${Colors.dark.focusRing}}}` +
  "input:focus-visible,textarea:focus-visible{outline:none}" +
  '[data-testid="conversation-row"]:focus-visible{outline-offset:-2px}' +
  "input,textarea,select{font-size:16px!important}" +
  "@media (min-width:768px){input,textarea,select{font-size:13px!important}}" +
  "[data-tauri-drag-region]{-webkit-app-region:drag;app-region:drag}" +
  '[data-tauri-drag-region="false"],button,a,input,textarea,[role="button"]{-webkit-app-region:no-drag;app-region:no-drag;cursor:pointer}' +
  // The face lib/header-font.ts falls back to on web: a local semibold sans whose advance widths
  // match Bricolage's within 0.6 px, so the lens tabs hold still when Bricolage swaps in late.
  '@font-face{font-family:"Bricolage Grotesque Fallback";src:local("SF Pro Text Semibold"),local("SFProText-Semibold"),local("Arial Bold"),local("Arial-BoldMT");font-weight:100 900}';

export function ensureGlobalWebCss(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (document.getElementById("imsg-global-css")) return;
  const style = document.createElement("style");
  style.id = "imsg-global-css";
  style.textContent = GLOBAL_WEB_CSS;
  document.head.appendChild(style);
}
