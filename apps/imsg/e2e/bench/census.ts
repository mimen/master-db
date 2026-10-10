/** Ordered outermost-last: a source is named by the first region containing it. */
export const REGIONS = ["conversation-row", "thread-message-list", "state-strip", "thread-view", "conversation-list-scroll", "triage-queue-header"];

export interface Shift { phase: string; region: string; value: number; node: string }

/**
 * Page init script: records every `layout-shift` entry not caused by input into `window.__shifts`,
 * one row per source node, named by region and by the phase in `window.__phase`.
 */
export const census = (regions: string[]): void => {
  const target = window as unknown as { __shifts: Shift[]; __phase: string };
  target.__shifts = [];
  target.__phase = "boot";
  const name = (node: Node | null): string => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    if (!el) return "unknown";
    for (const region of regions) if (el.closest(`[data-testid="${region}"]`)) return region;
    return "other";
  };
  const describe = (node: Node | null): string => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    if (!el) return "?";
    const id = el.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
    return `${el.tagName.toLowerCase()}${id ? `@${id}` : ""}`;
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null }> }>) {
      if (entry.hadRecentInput) continue;
      const sources = entry.sources?.length ? entry.sources : [{ node: null }];
      for (const source of sources) target.__shifts.push({ phase: target.__phase, region: name(source.node), value: entry.value, node: describe(source.node) });
    }
  }).observe({ type: "layout-shift", buffered: true });
};
