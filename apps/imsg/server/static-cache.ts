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
  if (path.includes("/_expo/static/")) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}
