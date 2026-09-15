type UndoAction = () => void;

interface UndoEntry {
  token: number;
  undo: UndoAction;
}

/**
 * ONE undo stack shared by every surface, so undo always means the last thing
 * the user did rather than the last thing the current screen did.
 *
 * Memory only, discarded on reload, and deliberately not persisted. The Settled
 * lens is the durable recovery path, so the stack only has to cover the working
 * session. Undo never carries an optimistic-concurrency anchor either. Every
 * entry restores a flag rather than clearing one, so it cannot hide a message
 * the user has not seen, and an anchor would make undo fail in exactly the
 * rapid-triage burst where it matters most.
 *
 * Ten is the bound because that is the whole span a user can still remember
 * having triaged. The sweep overlay's own cleared log shows the last three, and
 * a misfire run longer than ten is one the Settled lens recovers better than a
 * keypress can. Each entry also pins a conversation snapshot in its closure, so
 * the depth doubles as the fixed ceiling on what the stack keeps alive.
 */
const MAX_UNDO_DEPTH = 10;

let nextToken = 0;
const stack: UndoEntry[] = [];

/** Reserve ordering when a user action starts, before any async work settles. */
export function beginUndoAction(): number {
  nextToken += 1;
  return nextToken;
}

/**
 * Publish an undo, positioned by the token its action reserved rather than by
 * the moment its request came back. A slow request therefore lands *under* a
 * newer action's entry instead of jumping ahead of it. That is the same
 * ordering guarantee the single-slot version had, which it bought by dropping
 * the late entry outright; keeping it leaves the slow action undoable once the
 * newer ones have been popped.
 */
export function commitUndoAction(token: number, undo: UndoAction): void {
  let at = stack.length;
  while (at > 0 && stack[at - 1]!.token > token) at -= 1;
  stack.splice(at, 0, { token, undo });
  // Oldest out, never newest. An entry that arrives already older than
  // everything retained evicts itself here, which is the right answer for a
  // request so slow that ten actions have happened since.
  if (stack.length > MAX_UNDO_DEPTH) stack.shift();
}

/**
 * How many actions are still reachable. A surface that tracks its own steps
 * needs this to keep its undo affordance honest. Its own history can outlive
 * the depth bound, and offering an undo that would do nothing is the silent
 * failure the one triage gesture exists to remove.
 */
export function undoDepth(): number {
  return stack.length;
}

/** Pop and run the newest undo. False when there is nothing left to undo. */
export function runLatestUndo(): boolean {
  // Popped before running so an undo that publishes its own inverse appends
  // the new entry rather than having it consumed by this same call.
  const entry = stack.pop();
  if (!entry) return false;
  entry.undo();
  return true;
}

export function resetUndoForTests(): void {
  nextToken = 0;
  stack.length = 0;
}
