import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * App-wide user preferences. Same shape as drafts.ts — an in-memory value
 * mirrored to AsyncStorage — but reactive, so a change in the settings picker
 * updates every reader (the suggestion shelf) immediately.
 */
export type SuggestionMode = "off" | "on-demand" | "auto";

/** How the Contacts list orders and labels a person's name. "first-last" is
 * the default — today's untouched behavior ("First Last", sorted by first
 * name's section letter). "last-first" sorts/labels by last name instead
 * ("Last, First") — see lib/contact-order.ts for the pure derivation. */
export type NameOrder = "first-last" | "last-first";

export interface Settings {
  /** How reply suggestions appear: never, on a tap, or automatically on open. */
  suggestionMode: SuggestionMode;
  /** Contacts list name ordering — see NameOrder above. */
  nameOrder: NameOrder;
}

const KEY = "imsg.settings.v1";
const DEFAULT: Settings = { suggestionMode: "on-demand", nameOrder: "first-last" };

let state: Settings = { ...DEFAULT };
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isMode(value: unknown): value is SuggestionMode {
  return value === "off" || value === "on-demand" || value === "auto";
}

function isNameOrder(value: unknown): value is NameOrder {
  return value === "first-last" || value === "last-first";
}

export async function hydrateSettings(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    let changed = false;
    if (isMode(parsed.suggestionMode)) {
      state = { ...state, suggestionMode: parsed.suggestionMode };
      changed = true;
    }
    if (isNameOrder(parsed.nameOrder)) {
      state = { ...state, nameOrder: parsed.nameOrder };
      changed = true;
    }
    if (changed) emit();
  } catch {
    // storage unavailable — settings stay at defaults this session
  }
}

function persist(): void {
  void AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
}

export function setSuggestionMode(mode: SuggestionMode): void {
  if (state.suggestionMode === mode) return;
  state = { ...state, suggestionMode: mode };
  emit();
  persist();
}

export function setNameOrder(order: NameOrder): void {
  if (state.nameOrder === order) return;
  state = { ...state, nameOrder: order };
  emit();
  persist();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useSuggestionMode(): SuggestionMode {
  return useSyncExternalStore(
    subscribe,
    () => state.suggestionMode,
    () => state.suggestionMode,
  );
}

export function useNameOrder(): NameOrder {
  return useSyncExternalStore(
    subscribe,
    () => state.nameOrder,
    () => state.nameOrder,
  );
}
