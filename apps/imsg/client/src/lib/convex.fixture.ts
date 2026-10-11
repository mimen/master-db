import { useCallback, useEffect, useRef, useState } from "react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { PaginatedQueryArgs, PaginatedQueryItem, PaginatedQueryReference, UsePaginatedQueryObjectReturnType, UseQueryResult } from "convex/react";
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

export const convexClient = { query: call, mutation: call, action: call,
  watchQuery: <Ref extends Query>(ref: Ref, args: FunctionArgs<Ref>) => fixtureCommandWatch(() => call(ref, args)),
};

export function useAction<Ref extends Action>(ref: Ref) {
  return useCallback((args: FunctionArgs<Ref>) => call(ref, args), [ref]);
}

/** A failed result sticks until the subscription is replaced, as a failed Convex query does. */
function useFixtureQuery<Ref extends Query>(ref: Ref, args: FunctionArgs<Ref> | "skip"): UseQueryResult<FunctionReturnType<Ref>> {
  const key = JSON.stringify(args);
  const name = getFunctionName(ref);
  const [snapshot, setSnapshot] = useState<{ key: string; result: UseQueryResult<FunctionReturnType<Ref>> }>();
  useEffect(() => {
    if (key === '"skip"') return;
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await call(ref, JSON.parse(key) as FunctionArgs<Ref>);
        if (active) setSnapshot((current) => current?.key === key && current.result.status === "success"
          && JSON.stringify(current.result.data) === JSON.stringify(data) ? current : { key, result: { status: "success", data } });
      } catch (error) {
        if (!active) return;
        active = false;
        clearInterval(timer);
        setSnapshot({ key, result: { status: "error", error: error instanceof Error ? error : new Error(String(error)) } });
      } finally { inFlight = false; }
    };
    void load();
    timer = setInterval(() => { void load(); }, 500);
    return () => {
      active = false;
      clearInterval(timer);
      setSnapshot((current) => current?.result.status === "error" ? undefined : current);
    };
  }, [key, name]);
  return snapshot?.key === key ? snapshot.result : { status: "pending" };
}

export function useQuery<Ref extends Query>(ref: Ref, args: FunctionArgs<Ref> | "skip"): FunctionReturnType<Ref> | undefined {
  const result = useFixtureQuery(ref, args);
  if (result.status === "error") throw result.error;
  return result.status === "success" ? result.data : undefined;
}

export function useQuery_experimental<Ref extends Query>(options: { query: Ref; args: FunctionArgs<Ref> | "skip" }): UseQueryResult<FunctionReturnType<Ref>> {
  return useFixtureQuery(options.query, options.args);
}

function useFixturePages<Ref extends PaginatedQueryReference>(ref: Ref, args: PaginatedQueryArgs<Ref> | "skip", initialNumItems: number) {
  const [limit, setLimit] = useState(initialNumItems);
  const result = useFixtureQuery(ref, args === "skip" ? "skip" : {
    ...args, paginationOpts: { numItems: limit, cursor: null },
  } as FunctionArgs<Ref>);
  const loadMore = useCallback((count: number) => setLimit((value) => value + count), []);
  // Convex keeps the loaded pages on screen while the next one loads (LoadingMore), and drops them
  // when the subscription fails or is skipped.
  const argsKey = JSON.stringify(args);
  const loaded = useRef<{ argsKey: string; page: PaginatedQueryItem<Ref>[] }>(undefined);
  if (result.status === "success") loaded.current = { argsKey, page: result.data.page as PaginatedQueryItem<Ref>[] };
  else if (result.status === "error" || args === "skip") loaded.current = undefined;
  const held = result.status === "pending" && loaded.current?.argsKey === argsKey ? loaded.current.page : undefined;
  return { result, held, loadMore };
}

export function usePaginatedQuery<Ref extends PaginatedQueryReference>(ref: Ref, args: PaginatedQueryArgs<Ref> | "skip", options: { initialNumItems: number }) {
  const { result, held, loadMore } = useFixturePages(ref, args, options.initialNumItems);
  if (result.status === "error") throw result.error;
  if (result.status === "pending") return { results: held ?? [], status: held ? "LoadingMore" as const : "LoadingFirstPage" as const, loadMore };
  return {
    results: result.data.page as PaginatedQueryItem<Ref>[],
    status: result.data.isDone ? "Exhausted" as const : "CanLoadMore" as const,
    loadMore,
  };
}

export function usePaginatedQuery_experimental<Ref extends PaginatedQueryReference>(options: {
  query: Ref; args: PaginatedQueryArgs<Ref> | "skip"; initialNumItems: number;
}): UsePaginatedQueryObjectReturnType<Ref> {
  const { result, held, loadMore } = useFixturePages(options.query, options.args, options.initialNumItems);
  if (result.status === "pending") return { data: held, status: "pending", canLoadMore: false, isLoading: true, error: undefined, loadMore };
  if (result.status === "error") return { data: [], status: "error", canLoadMore: false, isLoading: false, error: result.error, loadMore };
  return { data: result.data.page as PaginatedQueryItem<Ref>[], status: "success", canLoadMore: !result.data.isDone, isLoading: false, error: undefined, loadMore };
}

/** The fixture has no local query store; its server echoes sends on the next poll. */
export function optimisticallyUpdateValueInPaginatedQuery(): void {}

export function useConvex() {
  return convexClient;
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}

export function useConvexConnectionState() {
  return { isWebSocketConnected: true, hasEverConnected: true };
}
