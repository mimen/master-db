import { describe, expect, test } from "bun:test";
import { extractText, Gateway, parseJsonBlock } from "./gateway";
import type { AiConfig } from "../config";

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

const config: AiConfig = {
  gatewayUrl: "http://127.0.0.1:8317", gatewayKey: "key", fastModel: "gpt-5.6-luna(low)",
  vaultPath: "", creatorRef: "test", ccsBin: "ccs", shadowSeat: "imsg-shadow", shadowCwd: "/tmp",
};

describe("structured output capability", () => {
  test("malformed output does not disable structured mode", async () => {
    const gateway = new Gateway(config);
    const structuredCalls: boolean[] = [];
    (gateway as unknown as { requestStructured: unknown }).requestStructured = async (
      _prompt: string,
      _schema: object,
      _options: object,
      structured: boolean,
    ) => {
      structuredCalls.push(structured);
      return { ok: false, error: { kind: "invalid-output", message: "bad json", status: null, retryAfterMs: null } };
    };
    await gateway.completeStructured("x", {}, { model: "claude-opus-5", maxTokens: 10, timeoutMs: 100 });
    await gateway.completeStructured("x", {}, { model: "claude-opus-5", maxTokens: 10, timeoutMs: 100 });
    expect(structuredCalls).toEqual([true, true]);
  });

  test("a schema rejection retries once and remembers capability", async () => {
    const gateway = new Gateway(config);
    const structuredCalls: boolean[] = [];
    (gateway as unknown as { requestStructured: unknown }).requestStructured = async (
      _prompt: string,
      _schema: object,
      _options: object,
      structured: boolean,
    ) => {
      structuredCalls.push(structured);
      return structured
        ? { ok: false, error: { kind: "schema-unsupported", message: "unsupported", status: 400, retryAfterMs: null } }
        : { ok: true, value: { ok: true } };
    };
    await gateway.completeStructured("x", {}, { model: "gpt-5.6-terra(medium)", maxTokens: 10, timeoutMs: 100 });
    await gateway.completeStructured("x", {}, { model: "gpt-5.6-terra(medium)", maxTokens: 10, timeoutMs: 100 });
    expect(structuredCalls).toEqual([true, false, false]);
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
