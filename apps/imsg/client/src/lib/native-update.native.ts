import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState } from "react-native";

import type { NativeUpdate } from "./native-update";

async function downloadAvailableUpdate(): Promise<void> {
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or off the tailnet: the next foreground retries.
  }
}

/**
 * iOS keeps Comma alive for days, so the launch-time check alone would leave an OTA
 * undelivered. Each foreground downloads any new update; applying it waits for the
 * user's Reload so a half-written reply is never discarded.
 */
export function useNativeUpdate(): NativeUpdate {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void downloadAvailableUpdate();
    });
    return () => subscription.remove();
  }, []);
  return { ready: isUpdatePending, apply: () => void Updates.reloadAsync() };
}

/** The crash screen's Reload: fetch any newer update, then restart on the newest one, so a bundle that crashes can be replaced. */
export function reloadApp(): boolean {
  if (!Updates.isEnabled) return false;
  void downloadAvailableUpdate().finally(() => void Updates.reloadAsync());
  return true;
}
