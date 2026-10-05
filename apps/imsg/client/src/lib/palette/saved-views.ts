import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateFilter, TypeFilter } from "@shared/types";

import { DEFAULT_REFINEMENTS, type Refinements } from "@/lib/inbox-model";

/** What one lens remembers: its People choice and every other refinement. */
export interface LensFilters {
  type: TypeFilter;
  refinements: Refinements;
}

/** A named filter set, opened from its chip or the palette. Not a lens. */
export interface SavedView extends LensFilters {
  id: string;
  name: string;
  state: StateFilter;
}

interface InboxFilterState {
  byLens: Partial<Record<StateFilter, LensFilters>>;
  views: SavedView[];
  /** A view the palette asked for, applied by the conversation list then cleared. */
  pending: SavedView | null;
}

const KEY = "imsg.inbox-filters.v1";

let state: InboxFilterState = { byLens: {}, views: [], pending: null };
let hydrated = false;
const listeners = new Set<() => void>();

function set(next: InboxFilterState, persist = true): void {
  state = next;
  for (const listener of listeners) listener();
  if (persist) void AsyncStorage.setItem(KEY, JSON.stringify({ byLens: state.byLens, views: state.views })).catch(() => undefined);
}

export function subscribeInboxFilters(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function inboxFilterSnapshot(): InboxFilterState {
  return state;
}

export async function hydrateInboxFilters(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<InboxFilterState>;
    set({ ...state, byLens: parsed.byLens ?? {}, views: Array.isArray(parsed.views) ? parsed.views : [] }, false);
  } catch {
    // storage unavailable or corrupt: filters start empty this session
  }
}

export function lensFilters(lens: StateFilter, fallbackType: TypeFilter): LensFilters {
  const saved = state.byLens[lens];
  return { type: saved?.type ?? fallbackType, refinements: { ...DEFAULT_REFINEMENTS, ...saved?.refinements } };
}

export function setLensFilters(lens: StateFilter, filters: LensFilters): void {
  set({ ...state, byLens: { ...state.byLens, [lens]: filters } });
}

export function saveView(view: Omit<SavedView, "id">): void {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  set({ ...state, views: [...state.views.filter((v) => v.name !== view.name), { ...view, id }] });
}

export function deleteView(id: string): void {
  set({ ...state, views: state.views.filter((v) => v.id !== id) });
}

/** The palette's "Open <view>": the conversation list picks it up. */
export function requestSavedView(id: string): void {
  const view = state.views.find((v) => v.id === id);
  if (view) set({ ...state, pending: view }, false);
}

export function takePendingView(): SavedView | null {
  const view = state.pending;
  if (view) set({ ...state, pending: null }, false);
  return view;
}
