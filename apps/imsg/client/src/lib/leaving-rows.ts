/** A row that just dropped out of the list, kept in place while it collapses. */
export interface LeavingRow<T> {
  readonly item: T;
  /** The key of the row it sat under, or null at the top. */
  readonly after: string | null;
}

/**
 * The rows that left between two renders of the same view, merged with any still collapsing.
 * A row that came back (Undo) stops leaving.
 */
export function nextLeaving<T>(
  previous: readonly T[],
  current: readonly T[],
  leaving: ReadonlyMap<string, LeavingRow<T>>,
  key: (item: T) => string,
): Map<string, LeavingRow<T>> {
  const present = new Set(current.map(key));
  const next = new Map([...leaving].filter(([k]) => !present.has(k)));
  // Neighbors come from what was on screen, still-collapsing rows included.
  const shown = withLeaving(previous, leaving, key);
  shown.forEach((item, index) => {
    const k = key(item);
    const prior = shown[index - 1];
    if (!present.has(k) && !next.has(k)) next.set(k, { item, after: prior === undefined ? null : key(prior) });
  });
  return next;
}

/** The list with each leaving row put back under its old neighbor, so the gap closes instead of cutting. */
export function withLeaving<T>(
  current: readonly T[],
  leaving: ReadonlyMap<string, LeavingRow<T>>,
  key: (item: T) => string,
): T[] {
  const out = [...current];
  let pending = [...leaving.values()];
  // Each pass places the rows whose neighbor is already in the list; a chain of leaves
  // resolves in order. A row whose neighbor is gone from both lists lands at the end.
  while (pending.length > 0) {
    const rest = pending.filter((row) => {
      const at = row.after === null ? 0 : out.findIndex((item) => key(item) === row.after) + 1;
      if (row.after !== null && at === 0) return true;
      out.splice(at, 0, row.item);
      return false;
    });
    if (rest.length === pending.length) {
      out.push(...rest.map((row) => row.item));
      break;
    }
    pending = rest;
  }
  return out;
}
