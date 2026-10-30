import { useCallback, useEffect, useRef, useState } from "react";
import type { OptimisticLocalStore, OptimisticUpdate } from "convex/browser";
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { Value } from "convex/values";
import type { PaginatedQueryArgs, PaginatedQueryReference } from "convex/react";
import { fixtureCommandWatch } from "./fixture-command-watch";

type Query = FunctionReference<"query">;
type Mutation = FunctionReference<"mutation">;
type Action = FunctionReference<"action">;

async function call<Ref extends Query | Mutation | Action>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> {
  const response = await fetch("/__fixture/convex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: getFunctionName(ref), args }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

interface Result { name: string; args: Record<string, unknown>; value: unknown }
interface Layer { update: OptimisticUpdate<Record<string, Value>>; args: Record<string, Value> }

/**
 * The fixture's local query store: the last polled result per query, with Convex's optimistic-update rule on top. A
 * mutation's update shows the moment it is called. When the mutation returns, every live query refreshes in one
 * transition that also drops the update, and only then does the mutation resolve, as Convex's client does. A failed
 * mutation drops its update at once.
 */
const results = new Map<string, Result>();
/** Per live query, its arguments and how many hooks hold it. */
const live = new Map<string, { name: string; args: Record<string, unknown>; holders: number }>();
const layers: Layer[] = [];
let view = new Map<string, unknown>();
const listeners = new Set<() => void>();
const FAILED = Symbol("failed");

const queryKey = (name: string, args: unknown) => `${name}:${JSON.stringify(args)}`;

function rebuild(): void {
  const next = new Map([...results].map(([key, result]) => [key, result.value]));
  const store: OptimisticLocalStore = {
    getQuery: (ref, args) => next.get(queryKey(getFunctionName(ref), args ?? {})) as never,
    getAllQueries: (ref) => [...results.values()].filter((result) => result.name === getFunctionName(ref))
      .map((result) => ({ args: result.args, value: next.get(queryKey(result.name, result.args)) })) as never,
    setQuery: (ref, args, value) => { next.set(queryKey(getFunctionName(ref), args), value); },
  };
  for (const layer of layers) layer.update(store, layer.args);
  view = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchQuery(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await call(makeFunctionReference<"query">(name), args);
  } catch {
    // A failed poll keeps the last value, as a dropped subscription update would.
    return FAILED;
  }
}

/** Keeps a polled value, and the previous object when nothing changed. Answers whether it changed. */
function keep(key: string, name: string, args: Record<string, unknown>, value: unknown): boolean {
  const prior = results.get(key);
  if (value === FAILED || (prior && JSON.stringify(prior.value) === JSON.stringify(value))) return false;
  results.set(key, { name, args, value });
  return true;
}

/** Polls one query while any hook holds it. */
function watch(name: string, args: Record<string, unknown>): () => void {
  const key = queryKey(name, args);
  const entry = live.get(key) ?? { name, args, holders: 0 };
  entry.holders++;
  live.set(key, entry);
  let inFlight = false;
  const poll = async () => {
    if (inFlight) return;
    inFlight = true;
    const value = await fetchQuery(name, args);
    inFlight = false;
    if (live.has(key) && keep(key, name, args, value)) rebuild();
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, 500);
  return () => {
    clearInterval(timer);
    if (--entry.holders === 0) live.delete(key);
  };
}

function drop(layer: Layer): void {
  const index = layers.indexOf(layer);
  if (index >= 0) layers.splice(index, 1);
  rebuild();
}

/** One server transition: every live query refreshed, applied in one rebuild without the landed update. */
async function transition(landed: Layer): Promise<void> {
  const fetched = await Promise.all([...live].map(async ([key, { name, args }]) => [key, name, args, await fetchQuery(name, args)] as const));
  for (const [key, name, args, value] of fetched) if (live.has(key)) keep(key, name, args, value);
  drop(landed);
}

async function mutation<Ref extends Mutation>(ref: Ref, args: FunctionArgs<Ref>,
  options?: { optimisticUpdate?: OptimisticUpdate<FunctionArgs<Ref>> }): Promise<FunctionReturnType<Ref>> {
  const layer: Layer | null = options?.optimisticUpdate
    ? { update: options.optimisticUpdate as OptimisticUpdate<Record<string, Value>>, args } : null;
  if (layer) {
    layers.push(layer);
    rebuild();
  }
  let value: FunctionReturnType<Ref>;
  try {
    value = await call(ref, args);
  } catch (error) {
    if (layer) drop(layer);
    throw error;
  }
  if (layer) await transition(layer);
  return value;
}

export const convexClient = { query: call, mutation, action: call,
  watchQuery: <Ref extends Query>(ref: Ref, args: FunctionArgs<Ref>) => fixtureCommandWatch(() => call(ref, args)),
};

export function useAction<Ref extends Action>(ref: Ref) {
  return useCallback((args: FunctionArgs<Ref>) => call(ref, args), [ref]);
}

/**
 * Delivers store changes as ordinary state updates, the way convex/react's hooks do. A synchronous external-store
 * render split a gesture's batched updates apart, and the workspace's selection sync then saw half of them.
 */
export function useQuery<Ref extends Query>(ref: Ref, args: FunctionArgs<Ref> | "skip"): FunctionReturnType<Ref> | undefined {
  // By name: anyApi hands out a new reference object on every property read.
  const name = getFunctionName(ref);
  const argsJson = JSON.stringify(args);
  const key = args === "skip" ? null : queryKey(name, args);
  const [shown, setShown] = useState<{ key: string | null; value: unknown }>({ key: null, value: undefined });
  useEffect(() => {
    if (key === null) return;
    const update = () => setShown((current) => (current.key === key && current.value === view.get(key) ? current : { key, value: view.get(key) }));
    update();
    const unlisten = subscribe(update);
    const unwatch = watch(name, JSON.parse(argsJson) as Record<string, unknown>);
    return () => { unlisten(); unwatch(); };
  }, [key, name, argsJson]);
  return (key === null ? undefined : shown.key === key ? shown.value : view.get(key)) as FunctionReturnType<Ref> | undefined;
}

export function usePaginatedQuery<Ref extends PaginatedQueryReference>(ref: Ref, args: PaginatedQueryArgs<Ref> | "skip", options: { initialNumItems: number }) {
  const [limit, setLimit] = useState(options.initialNumItems);
  const result = useQuery(ref, args === "skip" ? "skip" : {
    ...args, paginationOpts: { numItems: limit, cursor: null },
  } as FunctionArgs<Ref>);
  const loadMore = useCallback((count: number) => setLimit((value) => value + count), []);
  // Convex keeps the loaded pages on screen while the next one loads (LoadingMore).
  const argsKey = JSON.stringify(args);
  const loaded = useRef<{ argsKey: string; value: NonNullable<typeof result> }>(undefined);
  if (result !== undefined) loaded.current = { argsKey, value: result };
  const held = result ?? (loaded.current?.argsKey === argsKey ? loaded.current.value : undefined);
  return {
    results: held?.page ?? [],
    status: held === undefined ? "LoadingFirstPage" as const : result === undefined ? "LoadingMore" as const
      : result.isDone ? "Exhausted" as const : "CanLoadMore" as const,
    loadMore,
  };
}

/** convex/react's own rule: every loaded page of `query` whose arguments, less pagination, equal `args`. */
export function optimisticallyUpdateValueInPaginatedQuery<Ref extends PaginatedQueryReference>(
  store: OptimisticLocalStore, query: Ref, args: PaginatedQueryArgs<Ref>,
  update: (row: FunctionReturnType<Ref>["page"][number]) => FunctionReturnType<Ref>["page"][number],
): void {
  const expected = JSON.stringify(args);
  for (const { args: pageArgs, value } of store.getAllQueries(query)) {
    const { paginationOpts: _, ...rest } = pageArgs as Record<string, unknown>;
    const page = value as { page?: unknown } | undefined;
    if (JSON.stringify(rest) !== expected || !Array.isArray(page?.page)) continue;
    store.setQuery(query, pageArgs, { ...page, page: page.page.map(update) } as never);
  }
}

export function useConvex() {
  return convexClient;
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}

export function useConvexConnectionState() {
  return { isWebSocketConnected: true, hasEverConnected: true };
}
