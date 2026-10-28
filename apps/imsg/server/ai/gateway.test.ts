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
  vaultPath: "",
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

describe("request shape", () => {
  function capture(gateway: Gateway): Record<string, unknown>[] {
    const bodies: Record<string, unknown>[] = [];
    (gateway as unknown as { client: unknown }).client = {
      messages: {
        create: async (body: Record<string, unknown>) => {
          bodies.push(body);
          return { stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 2 } };
        },
      },
    };
    return bodies;
  }

  test("structured requests cache with the gateway's 1h TTL and report input tokens with cache reads", async () => {
    const gateway = new Gateway(config);
    const bodies = capture(gateway);
    const result = await gateway.completeStructured("x", {}, { model: "claude-opus-5", maxTokens: 10, timeoutMs: 100 });
    expect(result).toEqual({ ok: true, value: { ok: true }, usage: { input: 7, output: 2 } });
    expect(bodies[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(bodies[0]?.messages).toEqual([{ role: "user", content: "x" }]);
  });

  test("Opus 5.5 gets adaptive thinking, its effort and a system prompt", async () => {
    const gateway = new Gateway(config);
    const bodies = capture(gateway);
    await gateway.completeStructured("x", { type: "object" }, { model: "claude-opus-5-5", maxTokens: 10, timeoutMs: 100, effort: "medium", system: "rules" });
    expect(bodies[0]?.thinking).toEqual({ type: "adaptive" });
    expect(bodies[0]?.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: { type: "object" } } });
    expect(bodies[0]?.system).toBe("rules");
  });

  test("Haiku 5.5 takes an effort too", async () => {
    const gateway = new Gateway(config);
    const bodies = capture(gateway);
    await gateway.completeStructured("x", { type: "object" }, { model: "claude-haiku-5-5", maxTokens: 10, timeoutMs: 100, effort: "low" });
    expect(bodies[0]?.output_config).toMatchObject({ effort: "low" });
  });

  test("a call with history sends the turns in order and leaves caching to the gateway", async () => {
    const gateway = new Gateway(config);
    const bodies = capture(gateway);
    const history = [{ role: "user" as const, content: "first" }, { role: "assistant" as const, content: '{"brief":"b"}' }];
    await gateway.completeStructured("next", { type: "object" }, { model: "claude-opus-5-5", maxTokens: 10, timeoutMs: 100, system: "rules", history });
    expect(bodies[0]?.messages).toEqual([...history, { role: "user", content: "next" }]);
    expect(bodies[0]).not.toHaveProperty("cache_control");
    expect(bodies[0]?.system).toBe("rules");
    await gateway.completeStructured("solo", { type: "object" }, { model: "claude-opus-5-5", maxTokens: 10, timeoutMs: 100, history: [] });
    expect(bodies[1]?.cache_control, "empty history is a single turn").toEqual({ type: "ephemeral", ttl: "1h" });
  });

  test("a large max_tokens passes the SDK's streaming guard with the call's own timeout", async () => {
    const gateway = new Gateway(config);
    const requests: { path: string; timeout: unknown }[] = [];
    (gateway as unknown as { client: { post: unknown } }).client.post = (path: string, options: { timeout: unknown }) => {
      requests.push({ path, timeout: options.timeout });
      return Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: '{"memo":"m"}' }], usage: { input_tokens: 1, output_tokens: 1 } });
    };
    const result = await gateway.completeStructured("x", { type: "object" }, { model: "claude-opus-5-5", maxTokens: 32_000, timeoutMs: 600_000 });
    expect(result.ok).toBe(true);
    expect(requests).toEqual([{ path: "/v1/messages", timeout: 600_000 }]);
  });

  test("fast completions send no cache marker", async () => {
    const gateway = new Gateway(config);
    const bodies = capture(gateway);
    await gateway.complete("x");
    expect(bodies[0]?.cache_control).toBeUndefined();
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
