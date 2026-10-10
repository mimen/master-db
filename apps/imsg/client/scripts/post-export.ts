import { Palette } from "../src/constants/tokens";

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

/** Fonts painted on first frame: the sidebar's icons and the header face. */
const FIRST_PAINT_FONTS = [/\/Ionicons\.[0-9a-f]{32}\.ttf$/, /\/BricolageGrotesque-SemiBold\.[0-9a-f]{32}\.ttf$/];

/**
 * Preloads for the first-paint fonts, so they download beside the bundle instead of after it.
 * Registered after first paint, either one moves the sidebar header.
 */
export async function fontPreloads(outputDirectory: string): Promise<string> {
  const root = outputDirectory.replace(/\/$/, "");
  const files = [...new Bun.Glob("assets/**/*.ttf").scanSync(root)].map((file) => `/${file}`);
  return FIRST_PAINT_FONTS.flatMap((pattern) => files.filter((file) => pattern.test(file)))
    .map((href) => `<link rel="preload" href="${href}" as="font" type="font/ttf" crossorigin/>`)
    .join("");
}

/** Injects PWA head tags + a zoom-lock viewport into the exported SPA shell. */
export async function postExport(outputDirectory: string, webSha: string | undefined): Promise<void> {
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
if (!html.includes("manifest.webmanifest")) {
  html = html.replace("</head>", `${await fontPreloads(outputDirectory)}${tags}</head>`);
}
await Bun.write(path, html);
console.log("PWA tags + zoom lock injected");
}

if (import.meta.main) {
  const outputDirectory = process.argv[2]
    ?? new URL("../dist", import.meta.url).pathname;
  await postExport(outputDirectory, process.env.EXPO_PUBLIC_IMSG_WEB_SHA);
}
