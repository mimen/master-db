import { useEffect } from "react";
import { Platform } from "react-native";

import { publishBadgeCount } from "./badge-count";
import { setDesktopBadgeCount } from "./desktop-shell";

/** Mirrors Today's count onto the dock (desktop shell) or an installed web app's icon. undefined (still loading) leaves the last badge. */
export function useAppBadge(count: number | undefined): void {
  useEffect(() => {
    publishBadgeCount(count);
    if (count === undefined || Platform.OS !== "web" || typeof navigator === "undefined") return;
    if (setDesktopBadgeCount(count)) return;
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    if (count > 0) void nav.setAppBadge(count).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [count]);
}
