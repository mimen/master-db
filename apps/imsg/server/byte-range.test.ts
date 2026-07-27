import { describe, expect, test } from "bun:test";
import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  test("uses the full representation when no Range header is present", () => {
    expect(parseByteRange(null, 10)).toEqual({ kind: "full" });
  });

  test("resolves a bounded byte range", () => {
    expect(parseByteRange("bytes=0-1", 10)).toEqual({ kind: "partial", start: 0, end: 1 });
  });

  test("resolves an open-ended byte range", () => {
    expect(parseByteRange("bytes=4-", 10)).toEqual({ kind: "partial", start: 4, end: 9 });
  });

  test("clamps the requested end to the representation size", () => {
    expect(parseByteRange("bytes=7-99", 10)).toEqual({ kind: "partial", start: 7, end: 9 });
  });

  test("resolves a suffix byte range", () => {
    expect(parseByteRange("bytes=-3", 10)).toEqual({ kind: "partial", start: 7, end: 9 });
  });

  test("a suffix longer than the representation selects the whole body", () => {
    expect(parseByteRange("bytes=-20", 10)).toEqual({ kind: "partial", start: 0, end: 9 });
  });

  test("rejects a start at or beyond the representation size", () => {
    expect(parseByteRange("bytes=10-", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=12-20", 10)).toEqual({ kind: "unsatisfiable" });
  });

  test("rejects a range whose end precedes its start", () => {
    expect(parseByteRange("bytes=7-6", 10)).toEqual({ kind: "unsatisfiable" });
  });

  test("rejects every range for an empty representation", () => {
    expect(parseByteRange("bytes=0-1", 0)).toEqual({ kind: "unsatisfiable" });
  });

  test("distinguishes malformed and unsupported ranges", () => {
    expect(parseByteRange("items=0-1", 10)).toEqual({ kind: "invalid" });
    expect(parseByteRange("bytes=0-1,4-5", 10)).toEqual({ kind: "invalid" });
    expect(parseByteRange("bytes=-", 10)).toEqual({ kind: "invalid" });
  });

  test("rejects zero-length suffix and unsafe integer bounds", () => {
    expect(parseByteRange("bytes=-0", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=9007199254740992-", 10)).toEqual({ kind: "invalid" });
  });
});
