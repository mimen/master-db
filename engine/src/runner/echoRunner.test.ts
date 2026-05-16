import { describe, expect, test } from "vitest";

import { createEchoRunner } from "./echoRunner";
import type { CanonicalEvent } from "./types";

describe("EchoRunner", () => {
  test("emits a fixed event sequence and terminates with proposal", async () => {
    const events: CanonicalEvent[] = [];
    const runner = createEchoRunner();
    const result = await runner.run({
      entity_ref: "todoist:task:abc",
      resume_cursor: null,
      entity_payload: { content: "do thing" },
      message: null,
      on_event: async (e) => {
        events.push(e);
      },
    });
    expect(events[0]).toMatchObject({ type: "assistant_message" });
    expect(events[events.length - 1]).toMatchObject({ type: "proposal" });
    expect(result.terminal.type).toBe("proposal");
    expect(typeof result.resume_cursor).toBe("object");
  });

  test("with EXECUTE message terminates as execution_result", async () => {
    const runner = createEchoRunner();
    const result = await runner.run({
      entity_ref: "todoist:task:abc",
      resume_cursor: { turn: 1 },
      entity_payload: { content: "do thing" },
      message: "EXECUTE: opt-a",
      on_event: async () => {},
    });
    expect(result.terminal.type).toBe("execution_result");
  });

  test("interrupt resolves without error", async () => {
    const runner = createEchoRunner();
    await expect(runner.interrupt("todoist:task:abc")).resolves.toBeUndefined();
  });
});
