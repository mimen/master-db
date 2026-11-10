import { iosBuildToInstall, parseIosBuildRelease, type IosBuildRelease } from "@shared/release-identity";
import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { BASE_URL } from "@/lib/config";

import type { NativeUpdate } from "./native-update";

async function downloadAvailableUpdate(): Promise<void> {
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or off the tailnet: the next foreground retries.
  }
}

async function fetchIosBuildRelease(): Promise<IosBuildRelease | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/deploy/ios`);
    return response.ok ? parseIosBuildRelease(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * iOS keeps Comma alive for days, so the launch-time check alone would leave an OTA
 * undelivered. Each foreground downloads any new update; applying it waits for the
 * user's Reload so a half-written reply is never discarded.
 */
export function useNativeUpdate(): NativeUpdate {
  const { isUpdatePending } = Updates.useUpdates();
  const [build, setBuild] = useState<IosBuildRelease | null>(null);
  useEffect(() => {
    if (!Updates.isEnabled) return;
    // A new runtime gets no OTA, so the install link is the only way this install learns of it.
    const refreshBuild = () => void fetchIosBuildRelease().then((next) => next && setBuild(next));
    refreshBuild();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void downloadAvailableUpdate();
      refreshBuild();
    });
    return () => subscription.remove();
  }, []);
  return {
    ready: isUpdatePending,
    apply: () => void Updates.reloadAsync(),
    installUrl: iosBuildToInstall(build, Updates.runtimeVersion),
  };
}

/** The crash screen's Reload: fetch any newer update, then restart on the newest one, so a bundle that crashes can be replaced. */
export function reloadApp(): boolean {
  if (!Updates.isEnabled) return false;
  void downloadAvailableUpdate().finally(() => void Updates.reloadAsync());
  return true;
}
