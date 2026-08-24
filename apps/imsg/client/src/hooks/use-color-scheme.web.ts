import { useSyncExternalStore } from "react";
import type { ColorSchemeName } from "react-native";

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
const RECONCILE_INTERVAL_MS = 250;
const listeners = new Set<() => void>();

let colorScheme: ColorSchemeName = "light";
let darkModeQuery: MediaQueryList | null = null;
let reconcileInterval: number | null = null;

function getDarkModeQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  darkModeQuery ??= window.matchMedia(DARK_MODE_QUERY);
  return darkModeQuery;
}

function readSystemColorScheme(): ColorSchemeName {
  return getDarkModeQuery()?.matches ? "dark" : "light";
}

function reconcileColorScheme(): void {
  const next = readSystemColorScheme();
  if (next === colorScheme) return;
  colorScheme = next;
  for (const listener of listeners) listener();
}

function startReconciliation(): void {
  const query = getDarkModeQuery();
  if (query === null || reconcileInterval !== null) return;
  colorScheme = readSystemColorScheme();
  query.addEventListener("change", reconcileColorScheme);
  window.addEventListener("focus", reconcileColorScheme);
  window.addEventListener("pageshow", reconcileColorScheme);
  document.addEventListener("visibilitychange", reconcileColorScheme);
  reconcileInterval = window.setInterval(reconcileColorScheme, RECONCILE_INTERVAL_MS);
}

function stopReconciliation(): void {
  if (listeners.size > 0 || reconcileInterval === null) return;
  const query = getDarkModeQuery();
  query?.removeEventListener("change", reconcileColorScheme);
  window.removeEventListener("focus", reconcileColorScheme);
  window.removeEventListener("pageshow", reconcileColorScheme);
  document.removeEventListener("visibilitychange", reconcileColorScheme);
  window.clearInterval(reconcileInterval);
  reconcileInterval = null;
}

function getColorSchemeSnapshot(): ColorSchemeName {
  return colorScheme;
}

function getServerColorSchemeSnapshot(): ColorSchemeName {
  return "light";
}

function subscribeToColorScheme(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  startReconciliation();
  reconcileColorScheme();
  return () => {
    listeners.delete(onStoreChange);
    stopReconciliation();
  };
}

/**
 * Hydration-safe system appearance store for web and the desktop WebView.
 * Some engines update matchMedia().matches without delivering its change event;
 * a shared reconciliation loop prevents mounted and newly recycled views from
 * committing different theme snapshots.
 */
export function useColorScheme(): ColorSchemeName {
  return useSyncExternalStore(
    subscribeToColorScheme,
    getColorSchemeSnapshot,
    getServerColorSchemeSnapshot,
  );
}
