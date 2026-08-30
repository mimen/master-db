import { beforeEach, describe, expect, test } from "bun:test";
import {
  beginUndoAction,
  commitUndoAction,
  resetUndoForTests,
  runLatestUndo,
} from "./action-undo";

describe("action undo ordering", () => {
  beforeEach(() => resetUndoForTests());

  test("a slow older action cannot replace a newer committed undo", () => {
    const events: string[] = [];
    const older = beginUndoAction();
    const newer = beginUndoAction();

    commitUndoAction(newer, () => events.push("newer"));
    commitUndoAction(older, () => events.push("older"));

    expect(runLatestUndo()).toBe(true);
    expect(events).toEqual(["newer"]);
  });

  test("an older success remains undoable when a newer action fails", () => {
    const events: string[] = [];
    const older = beginUndoAction();
    beginUndoAction();

    commitUndoAction(older, () => events.push("older"));

    expect(runLatestUndo()).toBe(true);
    expect(events).toEqual(["older"]);
  });

  test("an undo can publish its inverse as the next entry", () => {
    const events: string[] = [];
    const initial = beginUndoAction();
    commitUndoAction(initial, () => {
      events.push("undo");
      const inverse = beginUndoAction();
      commitUndoAction(inverse, () => events.push("redo"));
    });

    expect(runLatestUndo()).toBe(true);
    expect(runLatestUndo()).toBe(true);
    expect(events).toEqual(["undo", "redo"]);
  });
});
