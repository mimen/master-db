import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { clampSidebarWidth, SIDEBAR_WIDTH_DEFAULT } from "./sidebar-metrics";

export {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "./sidebar-metrics";

const KEY = "imsg.sidebarWidth.v1";

let width = SIDEBAR_WIDTH_DEFAULT;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export async function hydrateSidebarWidth(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = Number(raw);
    const next = clampSidebarWidth(parsed);
    if (next === width) return;
    width = next;
    emit();
  } catch {
    // storage unavailable — keep the default this session
  }
}

function persist(next: number): void {
  void AsyncStorage.setItem(KEY, String(next)).catch(() => undefined);
}

export function setSidebarWidth(next: number): void {
  const clamped = clampSidebarWidth(next);
  if (clamped === width) return;
  width = clamped;
  emit();
  persist(clamped);
}

export function getSidebarWidth(): number {
  return width;
}

export function useSidebarWidth(): readonly [number, (next: number) => void] {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSidebarWidth,
    getSidebarWidth,
  );
  return [current, setSidebarWidth];
}
