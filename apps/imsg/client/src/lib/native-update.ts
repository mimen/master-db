export interface NativeUpdate {
  readonly ready: boolean;
  readonly apply: () => void;
  /** A new native build to install from Expo, when this install's runtime is behind. */
  readonly installUrl: string | null;
}

const NO_UPDATE: NativeUpdate = { ready: false, apply: () => undefined, installUrl: null };

/** Web and the desktop shell update through the release monitor; only the iOS build uses OTA. */
export function useNativeUpdate(): NativeUpdate {
  return NO_UPDATE;
}

/** False: the web page reloads itself, and the crash screen handles that. */
export function reloadApp(): boolean {
  return false;
}
