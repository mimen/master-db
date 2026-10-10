import { version as convexVersion } from "convex";

import { Palette } from "../src/constants/tokens";
import { bootScript, convexSocketUrl } from "../src/lib/boot-handoff";

/**
 * Painted while #root is still empty. React's first commit fills #root and the
 * selector stops matching, so nothing has to remove it. Grounds read
 * Palette.background so the boot frame matches the first paint.
 */
export const LOADING_SHELL_CSS =
  "body{margin:0}" +
  `#root:empty{background:${Palette.light.background}}` +
  `#root:empty::before{content:'';margin:auto;width:8px;height:8px;border-radius:50%;background:${Palette.light.textTertiary};` +
  "animation:comma-boot 1.2s ease-in-out .4s infinite alternate backwards}" +
  "@keyframes comma-boot{from{opacity:0}to{opacity:.6}}" +
  `@media (prefers-color-scheme:dark){#root:empty{background:${Palette.dark.background}}#root:empty::before{background:${Palette.dark.textTertiary}}}` +
  "@media (prefers-reduced-motion:reduce){#root:empty::before{animation:none;opacity:.4}}";

/** Injects PWA head tags + a zoom-lock viewport into the exported SPA shell. */
export async function postExport(outputDirectory: string, webSha: string | undefined, convexUrl?: string): Promise<void> {
const path = `${outputDirectory.replace(/\/$/, "")}/index.html`;
let html = await Bun.file(path).text();

// Replace Expo's default viewport with a safe-area-aware one.
html = html.replace(
  /<meta name="viewport"[^>]*\/?>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>',
);

html = html.replace(/<title>[^<]*<\/title>/, "<title>Comma</title>");

const tags = [
  '<link rel="manifest" href="/manifest.webmanifest"/>',
  '<link rel="icon" href="/favicon.png" type="image/png"/>',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>',
  '<meta name="application-name" content="Comma"/>',
  '<meta name="apple-mobile-web-app-title" content="Comma"/>',
  '<meta name="apple-mobile-web-app-capable" content="yes"/>',
  '<meta name="mobile-web-app-capable" content="yes"/>',
  `<meta name="theme-color" content="${Palette.dark.background}" media="(prefers-color-scheme: dark)"/>`,
  `<meta name="theme-color" content="${Palette.light.background}" media="(prefers-color-scheme: light)"/>`,
  // 16px inputs stop iOS Safari from zooming on focus; fill the dynamic viewport so a
  // standalone PWA doesn't leave a white bar over the home-indicator area.
  "<style>input,textarea,select{font-size:16px!important}" +
    "@media (min-width:768px){input,textarea,select{font-size:13px!important}}" +
    "[data-tauri-drag-region]{-webkit-app-region:drag;app-region:drag}" +
    '[data-tauri-drag-region="false"],button,a,input,textarea,[role="button"]{-webkit-app-region:no-drag;app-region:no-drag}' +
    "html,body,#root{height:100dvh!important;min-height:100dvh!important}" +
    "html{touch-action:manipulation;-webkit-text-size-adjust:100%}" +
    // Svelte, track-less scrollbars everywhere — a thin thumb, no container.
    "::-webkit-scrollbar{width:7px;height:7px}" +
    "::-webkit-scrollbar-track{background:transparent;border:none}" +
    "::-webkit-scrollbar-thumb{background:rgba(140,140,150,0.4);border-radius:10px;border:none}" +
    "::-webkit-scrollbar-thumb:hover{background:rgba(140,140,150,0.6)}" +
    "::-webkit-scrollbar-corner{background:transparent}" +
    // NOTE: never put scrollbar-gutter on * — overflow:hidden elements count as
    // scroll containers, so every avatar circle reserves a phantom gutter.
    // The thread scroller gets its gutter directly in thread-view.
    "*{scrollbar-width:thin;scrollbar-color:rgba(140,140,150,0.4) transparent}" +
    LOADING_SHELL_CSS +
    "</style>",
].join("");

if (webSha && !html.includes('name="comma-web-sha"')) {
  html = html.replace("</head>", `<meta name="comma-web-sha" content="${webSha}"/></head>`);
}
// Ahead of the bundle's deferred script, so the socket and token overlap its download.
if (convexUrl && !html.includes("__commaBoot")) {
  html = html.replace("<head>", `<head><script>${bootScript(convexSocketUrl(convexUrl, convexVersion))}</script>`);
}
if (!html.includes("manifest.webmanifest")) {
  html = html.replace("</head>", `${tags}</head>`);
}
await Bun.write(path, html);
console.log("PWA tags + zoom lock injected");
}

if (import.meta.main) {
  const outputDirectory = process.argv[2]
    ?? new URL("../dist", import.meta.url).pathname;
  const webSha = process.env.EXPO_PUBLIC_IMSG_WEB_SHA;
  // Only release and preview builds stamp a SHA. The fixture build must not open production Convex.
  await postExport(outputDirectory, webSha, webSha ? process.env.EXPO_PUBLIC_CONVEX_URL : undefined);
}
