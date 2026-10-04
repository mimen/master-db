import { useCallback, useEffect, useState } from "react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { PaginatedQueryArgs, PaginatedQueryReference } from "convex/react";
import { subscribeServerEvents } from "./sse";

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

export const convexClient = { query: call, mutation: call, action: call };

export function useAction<Ref extends Action>(ref: Ref) {
  return useCallback((args: FunctionArgs<Ref>) => call(ref, args), [ref]);
}

export function useQuery<Ref extends Query>(ref: Ref, args: FunctionArgs<Ref> | "skip"): FunctionReturnType<Ref> | undefined {
  const key = JSON.stringify(args);
  const name = getFunctionName(ref);
  const [snapshot, setSnapshot] = useState<{ key: string; value: FunctionReturnType<Ref> }>();
  useEffect(() => {
    if (key === '"skip"') return;
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await call(ref, JSON.parse(key) as FunctionArgs<Ref>);
        if (active) setSnapshot((current) => current?.key === key && JSON.stringify(current.value) === JSON.stringify(value) ? current : { key, value });
      } finally { inFlight = false; }
    };
    void load();
    const unsubscribe = subscribeServerEvents(() => { void load(); });
    const timer = setInterval(() => { void load(); }, 500);
    return () => { active = false; clearInterval(timer); unsubscribe(); };
  }, [key, name]);
  return snapshot?.key === key ? snapshot.value : undefined;
}

export function usePaginatedQuery<Ref extends PaginatedQueryReference>(ref: Ref, args: PaginatedQueryArgs<Ref> | "skip", options: { initialNumItems: number }) {
  const [limit, setLimit] = useState(options.initialNumItems);
  const result = useQuery(ref, args === "skip" ? "skip" : {
    ...args, paginationOpts: { numItems: limit, cursor: null },
  } as FunctionArgs<Ref>);
  const loadMore = useCallback((count: number) => setLimit((value) => value + count), []);
  return {
    results: result?.page ?? [],
    status: result === undefined ? "LoadingFirstPage" as const : result.isDone ? "Exhausted" as const : "CanLoadMore" as const,
    loadMore,
  };
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}
