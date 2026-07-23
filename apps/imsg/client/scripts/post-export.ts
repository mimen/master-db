/** Injects PWA head tags + a zoom-lock viewport into the exported SPA shell. */
const path = new URL("../dist/index.html", import.meta.url).pathname;
let html = await Bun.file(path).text();

// Replace Expo's default viewport with a zoom-locked, safe-area-aware one.
html = html.replace(
  /<meta name="viewport"[^>]*\/?>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>',
);

const tags = [
  '<link rel="manifest" href="/manifest.webmanifest"/>',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>',
  '<meta name="apple-mobile-web-app-capable" content="yes"/>',
  '<meta name="mobile-web-app-capable" content="yes"/>',
  '<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)"/>',
  '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"/>',
  // 16px inputs stop iOS Safari from zooming on focus; block gesture zoom;
  // never show the browser focus ring/outline; fill the dynamic viewport so a
  // standalone PWA doesn't leave a white bar over the home-indicator area.
  "<style>input,textarea,select{font-size:16px!important}" +
    // Policy: no focus outlines anywhere in this app — inputs, buttons, anything.
    "*:focus,*:focus-visible{outline:none!important;box-shadow:none!important}" +
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
    "*{scrollbar-width:thin;scrollbar-color:rgba(140,140,150,0.4) transparent}</style>",
].join("");

if (!html.includes("manifest.webmanifest")) {
  html = html.replace("</head>", `${tags}</head>`);
}
await Bun.write(path, html);
console.log("PWA tags + zoom lock injected");
