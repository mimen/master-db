import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SuggestionModel } from "@shared/types";

/**
 * App-wide user preferences. Same shape as drafts.ts — an in-memory value
 * mirrored to AsyncStorage — but reactive, so a change in the settings picker
 * updates every reader (the suggestion shelf) immediately.
 */
export type { Settings, SuggestionMode, NameOrder } from "./settings-values";
import { DEFAULT, parseSettings, type Settings, type SuggestionMode, type NameOrder } from "./settings-values";

const KEY = "imsg.settings.v2";

let state: Settings = { ...DEFAULT };
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export async function hydrateSettings(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    state = parseSettings(raw);
    emit();
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

export function setSuggestionModel(model: SuggestionModel): void {
  if (state.suggestionModel === model) return;
  state = { ...state, suggestionModel: model };
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

export function useSuggestionModel(): SuggestionModel {
  return useSyncExternalStore(
    subscribe,
    () => state.suggestionModel,
    () => state.suggestionModel,
  );
}

export function useNameOrder(): NameOrder {
  return useSyncExternalStore(
    subscribe,
    () => state.nameOrder,
    () => state.nameOrder,
  );
}
