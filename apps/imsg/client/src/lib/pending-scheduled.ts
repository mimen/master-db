import type { ScheduledMessageStatus } from "@shared/types";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Scheduled messages the user just cancelled or sent now, by Convex row id. Each leaves the queue
 * and its counts on the tap and stays out until the mirror agrees. `confirmed` once the bridge has
 * executed the command; only a confirmed one can retire.
 */
export type PendingScheduled = ReadonlyMap<string, { readonly confirmed: boolean }>;

const QUEUED: ReadonlySet<ScheduledMessageStatus> = new Set(["pending", "in-progress"]);

type Row = { readonly _id: string; readonly status: ScheduledMessageStatus };

/** `rows` without the pending ones. Returns `rows` itself when none is pending. */
export function withoutPendingScheduled<T extends Row>(rows: T[], pending: PendingScheduled): T[] {
  return pending.size === 0 || !rows.some((row) => pending.has(row._id)) ? rows : rows.filter((row) => !pending.has(row._id));
}

/** Drops confirmed ones the mirror no longer queues: a cancel deleted, a send now gone out. Returns `pending` itself when none retire. */
export function retirePendingScheduled(pending: PendingScheduled, rows: readonly Row[]): PendingScheduled {
  const queued = new Set(rows.filter((row) => QUEUED.has(row.status)).map((row) => row._id));
  const done = [...pending].filter(([id, { confirmed }]) => confirmed && !queued.has(id));
  if (done.length === 0) return pending;
  const next = new Map(pending);
  for (const [id] of done) next.delete(id);
  return next;
}

let pending: PendingScheduled = new Map();
const listeners = new Set<() => void>();

function publish(next: PendingScheduled): void {
  if (next === pending) return;
  pending = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Takes the message off the queue at once. */
export function pendScheduled(id: string): { confirm(): void; rollback(): void } {
  publish(new Map(pending).set(id, { confirmed: false }));
  return {
    confirm: () => { if (pending.has(id)) publish(new Map(pending).set(id, { confirmed: true })); },
    rollback: () => {
      if (!pending.has(id)) return;
      const next = new Map(pending);
      next.delete(id);
      publish(next);
    },
  };
}

/** `rows` as the user's pending cancels and sends leave them. Every listScheduled reader goes through this. */
export function usePendingScheduled<T extends Row>(rows: T[] | undefined): T[] | undefined {
  const current = useSyncExternalStore(subscribe, () => pending, () => pending);
  useEffect(() => {
    if (rows) publish(retirePendingScheduled(pending, rows));
  }, [rows, current]);
  return useMemo(() => rows && withoutPendingScheduled(rows, current), [rows, current]);
}
