import { readFileSync } from "node:fs";

/**
 * Version marker for the native desktop shell (Comma.app).
 *
 * deploy.sh writes apps/imsg/desktop/VERSION (the deployed short SHA) only
 * when a pull changed something under apps/imsg/desktop/. The laptop watcher
 * polls /api/desktop-version, compares against its last-built marker, and
 * rebuilds Comma.app when they differ. A missing or unreadable file means
 * "no shell update pending" — the watcher treats null as nothing to do.
 */
export function readDesktopVersion(root: string): string | null {
  try {
    const raw = readFileSync(`${root}/desktop/VERSION`, "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}
