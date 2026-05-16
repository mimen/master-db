import { describe, expect, test, vi } from "vitest";

import { createLogger } from "./logger";

describe("logger", () => {
  test("emits structured JSON to the provided sink", () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    log.info("hello", { entity_ref: "x" });
    expect(sink).toHaveBeenCalledTimes(1);
    const line = sink.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.entity_ref).toBe("x");
    expect(parsed.ts).toBeTypeOf("number");
  });

  test("error level captures stack from Error", () => {
    const sink = vi.fn();
    const log = createLogger({ sink });
    log.error("boom", { err: new Error("kaboom") });
    const parsed = JSON.parse(sink.mock.calls[0][0]);
    expect(parsed.err.message).toBe("kaboom");
    expect(parsed.err.stack).toBeTypeOf("string");
  });
});
