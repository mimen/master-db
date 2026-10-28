import { useConvex, useQuery } from "convex/react";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { todayWindow } from "@shared/today";
import { todayApi } from "@/lib/convex-api";
import { toTodayView, type TodayMode, type TodayView } from "@/lib/today";

interface TodayContextValue {
  day: string;
  dayStart: number;
  /** undefined while loading; null before today's first build was requested. */
  view: TodayView | null | undefined;
  /** Update continues the model session; fresh starts a new one. */
  request: (mode: TodayMode) => Promise<void>;
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
  const value = useMemo(() => ({ day, dayStart: start, view, request }), [day, start, view, request]);
  return createElement(TodayContext.Provider, { value }, children);
}

const OUTSIDE: TodayContextValue = { day: "", dayStart: 0, view: undefined, request: async () => undefined };

export function useToday(): TodayContextValue {
  return useContext(TodayContext) ?? OUTSIDE;
}
