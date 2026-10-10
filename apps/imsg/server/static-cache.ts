/**
 * Cache-Control for the Expo web export.
 * HTML must never be cached: Tauri and the PWA load this origin as a remote
 * shell, and a hashed JS filename only takes effect once index.html is fresh.
 */
export function staticCacheControl(urlPath: string): string {
  const path = urlPath.split("?")[0] ?? urlPath;
  if (path === "/" || path === "" || path.endsWith(".html") || path.endsWith(".webmanifest")) {
    return "no-store";
  }
  // Metro names every file under /assets/ by content hash (Ionicons.<md5>.ttf), so it is immutable too.
  if (path.includes("/_expo/static/") || /^\/assets\/.*\.[0-9a-f]{32}(@\dx)?\.\w+$/.test(path)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}
