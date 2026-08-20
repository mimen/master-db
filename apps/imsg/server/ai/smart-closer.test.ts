import { describe, expect, test } from "bun:test";
import { deterministicSmartCloser, parseSmartCloser } from "./smart-closer";

const valid = [
  { kind: "reply", label: "Reply", draft: "sounds good" },
  { kind: "done", label: "Done" },
  { kind: "later", label: "Later" },
  { kind: "call", label: "Call" },
  { kind: "react_done", label: "Like", reaction: "like" },
  { kind: "archive", label: "Archive" },
] as const;

describe("parseSmartCloser", () => {
  test("accepts every allowed discriminant", () => {
    for (const item of valid) expect(parseSmartCloser(item).ok).toBe(true);
  });

  test("rejects unknown kinds, extra fields, and malformed optional fields", () => {
    expect(parseSmartCloser({ kind: "send", label: "Send" }).ok).toBe(false);
    expect(parseSmartCloser({ kind: "done", label: "Done", draft: "no" }).ok).toBe(false);
    expect(parseSmartCloser({ kind: "reply", label: "Reply", draft: "" }).ok).toBe(false);
    expect(parseSmartCloser({ kind: "react_done", label: "React", reaction: 42 }).ok).toBe(false);
  });
});

describe("deterministicSmartCloser", () => {
  test("degrades only to Reply or Done", () => {
    expect(deterministicSmartCloser("thanks")).toEqual({ kind: "done", label: "Done" });
    expect(deterministicSmartCloser("can you send that over?")).toEqual({ kind: "reply", label: "Reply" });
  });
});
