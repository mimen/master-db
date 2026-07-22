import { describe, expect, test } from "bun:test";
import { extractText, parseJsonBlock } from "./gateway";

describe("extractText", () => {
  test("concatenates text blocks", () => {
    expect(extractText({ content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] })).toBe(
      "Hello world",
    );
  });

  test("drops thinking blocks, which carry no text", () => {
    expect(
      extractText({
        content: [
          { type: "thinking", text: undefined },
          { type: "text", text: "answer" },
        ],
      }),
    ).toBe("answer");
  });

  test("returns empty string for missing or empty content", () => {
    expect(extractText({})).toBe("");
    expect(extractText({ content: [] })).toBe("");
  });
});

describe("parseJsonBlock", () => {
  test("parses a bare array", () => {
    const result = parseJsonBlock<string[]>('["a", "b"]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["a", "b"]);
  });

  test("recovers JSON the model wrapped in prose", () => {
    const result = parseJsonBlock<string[]>('Sure! Here you go:\n["Warehouse", "Loading Dock"]\nHope that helps.');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["Warehouse", "Loading Dock"]);
  });

  test("recovers JSON from a fenced code block", () => {
    const result = parseJsonBlock<{ name: string }>('```json\n{"name": "Sarah"}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: "Sarah" });
  });

  test("does not stop at a bracket inside a string", () => {
    const result = parseJsonBlock<string[]>('["a ] bracket", "b"]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["a ] bracket", "b"]);
  });

  test("handles escaped quotes inside strings", () => {
    const result = parseJsonBlock<string[]>('["she said \\"hi\\"", "b"]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['she said "hi"', "b"]);
  });

  test("parses nested structures to the balanced close", () => {
    const result = parseJsonBlock<{ a: { b: number[] } }>('prefix {"a": {"b": [1, 2]}} suffix');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: { b: [1, 2] } });
  });

  test("fails on output with no JSON", () => {
    expect(parseJsonBlock("I cannot help with that.").ok).toBe(false);
  });

  test("fails on unbalanced JSON rather than guessing", () => {
    expect(parseJsonBlock('["a", "b"').ok).toBe(false);
  });
});
