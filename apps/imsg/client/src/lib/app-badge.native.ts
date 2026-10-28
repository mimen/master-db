import * as Notifications from "expo-notifications";
import { useEffect } from "react";

let badgeAllowed: Promise<boolean> | undefined;

function allowBadge(): Promise<boolean> {
  badgeAllowed ??= Notifications.requestPermissionsAsync({ ios: { allowBadge: true } })
    .then((permission) => permission.ios?.allowsBadge ?? permission.granted)
    .catch(() => false);
  return badgeAllowed;
}

/** Mirrors a count onto the home-screen icon. undefined (still loading) leaves the last badge in place. */
export function useAppBadge(count: number | undefined): void {
  useEffect(() => {
    if (count === undefined) return;
    void allowBadge().then((allowed) => allowed && Notifications.setBadgeCountAsync(count)).catch(() => undefined);
  }, [count]);
}
