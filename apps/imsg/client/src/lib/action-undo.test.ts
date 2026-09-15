import { beforeEach, describe, expect, test } from "bun:test";
import {
  beginUndoAction,
  commitUndoAction,
  resetUndoForTests,
  runLatestUndo,
  undoDepth,
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

describe("the shared undo stack", () => {
  beforeEach(() => resetUndoForTests());

  test("undo walks back through several actions, newest first", () => {
    const events: string[] = [];
    for (const name of ["first", "second", "third"]) {
      commitUndoAction(beginUndoAction(), () => events.push(name));
    }

    expect(runLatestUndo()).toBe(true);
    expect(runLatestUndo()).toBe(true);
    expect(runLatestUndo()).toBe(true);
    expect(events).toEqual(["third", "second", "first"]);
  });

  test("it stops cleanly once the stack is empty", () => {
    const events: string[] = [];
    commitUndoAction(beginUndoAction(), () => events.push("only"));

    expect(runLatestUndo()).toBe(true);
    expect(runLatestUndo()).toBe(false);
    expect(runLatestUndo()).toBe(false);
    expect(events).toEqual(["only"]);
  });

  test("the depth bound drops the oldest entry, never the newest", () => {
    const events: string[] = [];
    for (let action = 1; action <= 12; action += 1) {
      commitUndoAction(beginUndoAction(), () => events.push(`action-${action}`));
    }

    for (let press = 0; press < 12; press += 1) runLatestUndo();

    // Twelve actions into ten slots: 1 and 2 fell off the bottom, and the two
    // presses past the bottom did nothing rather than reaching them.
    expect(events).toEqual([
      "action-12",
      "action-11",
      "action-10",
      "action-9",
      "action-8",
      "action-7",
      "action-6",
      "action-5",
      "action-4",
      "action-3",
    ]);
  });

  test("ten actions all stay reachable", () => {
    const events: string[] = [];
    for (let action = 1; action <= 10; action += 1) {
      commitUndoAction(beginUndoAction(), () => events.push(`action-${action}`));
    }

    for (let press = 0; press < 10; press += 1) {
      expect(runLatestUndo()).toBe(true);
    }
    expect(runLatestUndo()).toBe(false);
    expect(events).toEqual([
      "action-10",
      "action-9",
      "action-8",
      "action-7",
      "action-6",
      "action-5",
      "action-4",
      "action-3",
      "action-2",
      "action-1",
    ]);
  });

  test("depth reports what is still reachable, never more than the bound", () => {
    expect(undoDepth()).toBe(0);

    commitUndoAction(beginUndoAction(), () => undefined);
    commitUndoAction(beginUndoAction(), () => undefined);
    expect(undoDepth()).toBe(2);

    runLatestUndo();
    expect(undoDepth()).toBe(1);

    for (let action = 0; action < 20; action += 1) {
      commitUndoAction(beginUndoAction(), () => undefined);
    }
    expect(undoDepth()).toBe(10);

    for (let press = 0; press < 10; press += 1) runLatestUndo();
    expect(undoDepth()).toBe(0);
  });

  test("a slow action lands under the newer entries instead of on top", () => {
    const events: string[] = [];
    const slow = beginUndoAction();
    const quick = beginUndoAction();
    const quicker = beginUndoAction();

    commitUndoAction(quick, () => events.push("quick"));
    commitUndoAction(quicker, () => events.push("quicker"));
    commitUndoAction(slow, () => events.push("slow"));

    expect(runLatestUndo()).toBe(true);
    expect(runLatestUndo()).toBe(true);
    expect(runLatestUndo()).toBe(true);
    // Reverse action order, not reverse completion order — and the slow entry
    // is still undoable rather than dropped.
    expect(events).toEqual(["quicker", "quick", "slow"]);
  });
});
