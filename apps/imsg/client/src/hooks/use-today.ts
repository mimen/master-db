import { useConvex, useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { todayWindow } from "@shared/today";
import type { ChatSummary } from "@shared/types";
import { conversationToChat } from "@/lib/convex-adapters";
import { commaApi, todayApi } from "@/lib/convex-api";
import { inLens } from "@/lib/mail-lens";
import { toTodayView, type TodayMode, type TodayView } from "@/lib/today";

interface TodayContextValue {
  day: string;
  dayStart: number;
  /** undefined while loading; null before today's first build was requested. */
  view: TodayView | null | undefined;
  /** Update continues the model session; fresh starts a new one. */
  request: (mode: TodayMode) => Promise<void>;
  /** The Mail workspace's People lens, which Today ranks beside the Messages directory. */
  mail: readonly ChatSummary[];
}

const TodayContext = createContext<TodayContextValue | null>(null);

/** The LA day, moved forward at its midnight: a live query never reruns because time passed. */
function useTodayWindow() {
  const [current, setCurrent] = useState(() => todayWindow(Date.now()));
  useEffect(() => {
    // A day is 23 to 25 hours long, so 30 hours past midnight always lands in the next one.
    const next = todayWindow(current.start + 30 * 3_600_000).start;
    const timer = setTimeout(() => setCurrent(todayWindow(Date.now())), Math.max(1_000, next - Date.now()));
    return () => clearTimeout(timer);
  }, [current.start]);
  return current;
}

export function TodayProvider({ children }: { readonly children: ReactNode }) {
  const { day, start } = useTodayWindow();
  const row = useQuery(todayApi.get, { day });
  const view = useMemo(() => (row === undefined ? undefined : toTodayView(row)), [row]);
  const convex = useConvex();
  // Idempotent while a build is queued or running, so a double press is harmless.
  const request = useCallback(async (mode: TodayMode) => { await convex.mutation(todayApi.requestBuild, { day, dayStart: start, mode }); }, [convex, day, start]);
  const mail = useTodayMail();
  const value = useMemo(() => ({ day, dayStart: start, view, request, mail }), [day, start, view, request, mail]);
  return createElement(TodayContext.Provider, { value }, children);
}

const NO_MAIL: readonly ChatSummary[] = [];

// ponytail: the newest 50 inbox threads, as the Mail list starts; a People thread past them stays in Mail until it is newer.
function useTodayMail(): readonly ChatSummary[] {
  const { isAuthenticated } = useConvexAuth();
  const { results } = usePaginatedQuery(commaApi.listEmailThreads, isAuthenticated ? {} : "skip", { initialNumItems: 50 });
  return useMemo(() => {
    const people = results.filter((row) => inLens(row, "people"));
    return people.length ? people.map(conversationToChat) : NO_MAIL;
  }, [results]);
}

const OUTSIDE: TodayContextValue = { day: "", dayStart: 0, view: undefined, request: async () => undefined, mail: NO_MAIL };

export function useToday(): TodayContextValue {
  return useContext(TodayContext) ?? OUTSIDE;
}
