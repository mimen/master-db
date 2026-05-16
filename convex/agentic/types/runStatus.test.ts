import { describe, expect, test } from "vitest";

import {
  isRunStatus,
  isThreadMessageKind,
  isActivityKind,
  RUN_STATUSES,
} from "./runStatus";

describe("agentic enums", () => {
  test("isRunStatus accepts canonical values", () => {
    expect(isRunStatus("idle")).toBe(true);
    expect(isRunStatus("awaiting_decision")).toBe(true);
    expect(isRunStatus("nope")).toBe(false);
  });

  test("isThreadMessageKind", () => {
    expect(isThreadMessageKind("proposal")).toBe(true);
    expect(isThreadMessageKind("garbage")).toBe(false);
  });

  test("isActivityKind", () => {
    expect(isActivityKind("tool_call")).toBe(true);
    expect(isActivityKind("garbage")).toBe(false);
  });

  test("RUN_STATUSES is exhaustive and read-only", () => {
    expect(RUN_STATUSES).toEqual([
      "idle",
      "discovering",
      "awaiting_decision",
      "executing",
      "error",
    ]);
  });
});
