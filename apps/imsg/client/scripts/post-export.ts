/** Injects PWA head tags into the exported SPA shell (expo export drops custom head). */
const path = new URL("../dist/index.html", import.meta.url).pathname;
let html = await Bun.file(path).text();
const tags = [
  '<link rel="manifest" href="/manifest.webmanifest"/>',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>',
  '<meta name="apple-mobile-web-app-capable" content="yes"/>',
  '<meta name="mobile-web-app-capable" content="yes"/>',
  '<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)"/>',
  '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"/>',
].join("");
if (!html.includes("manifest.webmanifest")) {
  html = html.replace("</head>", `${tags}</head>`);
  await Bun.write(path, html);
  console.log("PWA tags injected");
} else {
  console.log("PWA tags already present");
}
