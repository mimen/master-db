export interface NativeUpdate {
  readonly ready: boolean;
  readonly apply: () => void;
}

const NO_UPDATE: NativeUpdate = { ready: false, apply: () => undefined };

/** Web and the desktop shell update through the release monitor; only the iOS build uses OTA. */
export function useNativeUpdate(): NativeUpdate {
  return NO_UPDATE;
}

/** False: the web page reloads itself, and the crash screen handles that. */
export function reloadApp(): boolean {
  return false;
}
