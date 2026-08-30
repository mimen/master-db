type UndoAction = () => void;

let nextToken = 0;
let latestCommittedToken = 0;
let latestUndo: UndoAction | null = null;

/** Reserve ordering when a user action starts, before any async work settles. */
export function beginUndoAction(): number {
  nextToken += 1;
  return nextToken;
}

/**
 * Publish an undo only if no newer user action has already committed one.
 * This prevents a slow request from replacing a later action's undo entry.
 */
export function commitUndoAction(token: number, undo: UndoAction): void {
  if (token < latestCommittedToken) return;
  latestCommittedToken = token;
  latestUndo = undo;
}

export function runLatestUndo(): boolean {
  const undo = latestUndo;
  if (!undo) return false;
  latestUndo = null;
  undo();
  return true;
}

export function resetUndoForTests(): void {
  nextToken = 0;
  latestCommittedToken = 0;
  latestUndo = null;
}
