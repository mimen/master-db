import { describe, expect, test } from "vitest";

import { constantTimeEqual } from "./constantTimeEqual";

describe("constantTimeEqual", () => {
  test("accepts an exact match and rejects differences at either end or in length", () => {
    expect(constantTimeEqual("abcdef", "abcdef")).toBe(true);
    for (const provided of ["", "abcde", "abcdefg", "xbcdef", "abcdex"]) {
      expect(constantTimeEqual("abcdef", provided)).toBe(false);
    }
  });
});
