import { useSyncExternalStore } from "react";
import { Appearance, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SuggestionModel } from "@shared/types";

/**
 * App-wide user preferences. Same shape as drafts.ts — an in-memory value
 * mirrored to AsyncStorage — but reactive, so a change in the settings picker
 * updates every reader (the suggestion shelf) immediately.
 */
export type { Settings, SuggestionMode, NameOrder, ThemePreference, OpenOnLens, GroupConversationsBy } from "./settings-values";
import {
  DEFAULT,
  parseSettings,
  type GroupConversationsBy,
  type NameOrder,
  type OpenOnLens,
  type Settings,
  type SuggestionMode,
  type ThemePreference,
} from "./settings-values";

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
    applyTheme(state.theme);
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

/** Native pins the appearance through RN; web reads the preference in use-color-scheme.web.ts. */
function applyTheme(theme: ThemePreference): void {
  if (Platform.OS !== "web") Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
}

export function setTheme(theme: ThemePreference): void {
  if (state.theme === theme) return;
  state = { ...state, theme };
  applyTheme(theme);
  emit();
  persist();
}

/** Stored only; the conversation list reads it when the filters unit wires it in. */
export function setOpenOn(openOn: OpenOnLens): void {
  if (state.openOn === openOn) return;
  state = { ...state, openOn };
  emit();
  persist();
}

/** Stored only; the conversation list reads it when the filters unit wires it in. */
export function setGroupBy(groupBy: GroupConversationsBy): void {
  if (state.groupBy === groupBy) return;
  state = { ...state, groupBy };
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

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => state.theme, () => state.theme);
}

export function useOpenOn(): OpenOnLens {
  return useSyncExternalStore(subscribe, () => state.openOn, () => state.openOn);
}

export function useGroupBy(): GroupConversationsBy {
  return useSyncExternalStore(subscribe, () => state.groupBy, () => state.groupBy);
}
