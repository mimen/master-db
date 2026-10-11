import {
  usePaginatedQuery_experimental,
  useQuery_experimental,
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type PaginatedQueryReference,
} from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";

/** Waits before each resubscribe. A sustained overload settles at one attempt every 10 s. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

type Retry = { readonly key: string; readonly attempt: number; readonly paused: boolean };
const NONE: never[] = [];

/** Retry state for these args; new args start clean. */
function useRetryState(args: unknown) {
  const key = JSON.stringify(args);
  const [state, setState] = useState<Retry>({ key, attempt: 0, paused: false });
  return { key, setState, ...(state.key === key ? state : { attempt: 0, paused: false }) };
}

/**
 * A failed Convex query stays failed until its subscription is replaced, so after each backoff
 * delay the caller skips the query for one render, which drops the subscription and starts a new one.
 * `failed` holds from the first error until a retry succeeds, so the UI does not flicker per attempt.
 */
function useBackoff(status: "pending" | "success" | "error", { key, attempt, paused, setState }: ReturnType<typeof useRetryState>) {
  useEffect(() => {
    if (paused) setState({ key, attempt, paused: false });
    else if (status === "success" && attempt > 0) setState({ key, attempt: 0, paused: false });
  }, [paused, status, attempt, key, setState]);
  useEffect(() => {
    if (status !== "error") return;
    const timer = setTimeout(() => setState({ key, attempt: attempt + 1, paused: true }),
      RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    return () => clearTimeout(timer);
  }, [status, attempt, key, setState]);
  const retry = useCallback(() => setState({ key, attempt, paused: true }), [key, attempt, setState]);
  return { failed: status === "error" || attempt > 0, retry };
}

/** The newest data seen for these args, so a failure or a resubscribe keeps what is on screen. */
function useLastGood<T>(args: unknown, data: T | undefined): T | undefined {
  const key = JSON.stringify(args);
  const held = useRef<{ key: string; data: T }>(undefined);
  if (data !== undefined) held.current = { key, data };
  return data ?? (held.current?.key === key ? held.current.data : undefined);
}

/** useQuery that reports a server error instead of throwing it into render, and resubscribes with backoff. */
export function useRetryingQuery<Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") {
  const retry = useRetryState(args);
  const live = useQuery_experimental({ query, args: retry.paused ? "skip" : args });
  const data = useLastGood<FunctionReturnType<Query>>(args, live.status === "success" ? live.data : undefined);
  return { data, ...useBackoff(live.status, retry) };
}

/**
 * usePaginatedQuery's shape, from the SDK's non-throwing variant. While a page has failed it keeps
 * the last loaded rows and resubscribes with backoff; pagination restarts from the first page.
 */
export function useRetryingPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query> | "skip",
  initialNumItems: number,
) {
  const retry = useRetryState(args);
  const live = usePaginatedQuery_experimental({ query, args: retry.paused ? "skip" : args, initialNumItems });
  const held = useLastGood<PaginatedQueryItem<Query>[]>(args, live.status === "error" ? undefined : live.data);
  const status = live.status === "success" ? (live.canLoadMore ? "CanLoadMore" : "Exhausted")
    : held ? "LoadingMore" : "LoadingFirstPage";
  return { results: held ?? NONE, status, loadMore: live.loadMore, ...useBackoff(live.status, retry) } as const;
}
