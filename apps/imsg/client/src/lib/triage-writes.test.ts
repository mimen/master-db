import { beforeEach, describe, expect, test } from "bun:test";

import type { ConversationId } from "@shared/types";
import { resetTriageWritesForTests, runExclusiveTriageWrite } from "./triage-writes";

const CHAT_A = "conv-a" as ConversationId;
const CHAT_B = "conv-b" as ConversationId;
const CHAT_C = "conv-c" as ConversationId;

/** A write the test resolves by hand, standing in for the dismiss round trip. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("per-conversation triage write exclusion", () => {
  beforeEach(() => resetTriageWritesForTests());

  test("a second press while the first is in flight issues no write", async () => {
    const writes: string[] = [];
    const first = deferred();

    const firstPress = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("dismiss");
      return first.promise;
    });
    const secondPress = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("undismiss");
      return Promise.resolve();
    });

    expect(await secondPress).toBe("busy");
    expect(writes).toEqual(["dismiss"]);

    first.resolve();
    expect(await firstPress).toBe("done");
    // The conflicting undismiss never reached the server, so the client's
    // rendered state and the server's stored state cannot disagree.
    expect(writes).toEqual(["dismiss"]);
  });

  test("the conversation accepts the next write once the first resolves", async () => {
    const writes: string[] = [];
    const first = deferred();

    const firstPress = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("dismiss");
      return first.promise;
    });
    first.resolve();
    expect(await firstPress).toBe("done");

    const secondPress = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("undismiss");
      return Promise.resolve();
    });

    expect(await secondPress).toBe("done");
    expect(writes).toEqual(["dismiss", "undismiss"]);
  });

  test("a failed write releases the conversation and propagates the failure", async () => {
    const writes: string[] = [];
    const failing = deferred();

    const firstPress = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("dismiss");
      return failing.promise;
    });
    failing.reject(new Error("409: anchor moved"));
    expect(await firstPress.then(() => "resolved", (error: Error) => error.message)).toBe(
      "409: anchor moved",
    );

    const retry = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("dismiss-retry");
      return Promise.resolve();
    });

    expect(await retry).toBe("done");
    expect(writes).toEqual(["dismiss", "dismiss-retry"]);
  });

  test("a write to another conversation is never blocked", async () => {
    const writes: string[] = [];
    const held = deferred();

    const heldPress = runExclusiveTriageWrite(CHAT_A, () => {
      writes.push("a");
      return held.promise;
    });
    const otherPress = runExclusiveTriageWrite(CHAT_B, () => {
      writes.push("b");
      return Promise.resolve();
    });
    const thirdPress = runExclusiveTriageWrite(CHAT_C, () => {
      writes.push("c");
      return Promise.resolve();
    });

    expect(await otherPress).toBe("done");
    expect(await thirdPress).toBe("done");
    expect(writes).toEqual(["a", "b", "c"]);

    held.resolve();
    expect(await heldPress).toBe("done");
  });
});

