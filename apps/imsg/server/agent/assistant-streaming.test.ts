/*
 * Vendored from T3 Code, apps/server/src/orchestration-v2/assistantStreaming.test.ts
 * at commit 500a52e839b5ee16e0c697ac04694068a2e084eb.
 * MIT License, Copyright (c) 2026 T3 Tools Inc. https://github.com/pingdotgg/t3code
 * Local change: bun:test, and fixtures reduced to the local StreamingEvent shape.
 */
import { describe, expect, it } from "bun:test";
import { makeAssistantStreamingFilter, splitBufferedAssistantText, type StreamingEvent } from "./assistant-streaming";

const message = (text: string, streaming = true): StreamingEvent => ({
  type: "message.updated",
  message: { id: "message", role: "assistant", text, streaming },
});

const turnItem = (
  text: string,
  streaming = true,
  type: "assistant_message" | "reasoning" = "assistant_message",
): StreamingEvent => ({
  type: "turn_item.updated",
  turnItem: { id: "item", type, text, streaming },
});

describe("V2 assistant streaming", () => {
  it("delivers completed paragraphs, coalesces rapid updates, and flushes final text", () => {
    const filter = makeAssistantStreamingFilter("paragraph");
    expect(filter(message("First"), 0)).toBeNull();
    expect(filter(message("First\n\nSec"), 10)).toMatchObject({ message: { text: "First\n\n" } });
    expect(filter(message("First\n\nSecond\n\nThi"), 100)).toBeNull();
    expect(filter(message("First\n\nSecond\n\nThird"), 410)).toMatchObject({
      message: { text: "First\n\nSecond\n\n" },
    });
    const final = message("First\n\nSecond\n\nThird", false);
    expect(filter(final, 420)).toBe(final);
  });
  it("keeps code fences intact", () => {
    expect(splitBufferedAssistantText("Intro\n\n```ts\nx()\n\n")).toEqual({
      ready: "Intro\n\n",
      rest: "```ts\nx()\n\n",
    });
    expect(splitBufferedAssistantText("```ts\nx()\n```\nrest")).toEqual({
      ready: "```ts\nx()\n```\n",
      rest: "rest",
    });
  });
  it("holds streaming text until the full response completes", () => {
    const running = message("partial");
    const final = message("complete", false);
    const buffered = makeAssistantStreamingFilter("turn");
    expect(buffered(running, 0)).toBeNull();
    expect(buffered(message("First\n\nSecond\n\n"), 500)).toBeNull();
    expect(buffered(final, 501)).toBe(final);
  });

  it.each(["assistant_message", "reasoning"] as const)(
    "buffers %s at paragraph boundaries and flushes the final item",
    (type) => {
      const item = (text: string, streaming = true) => turnItem(text, streaming, type);
      const filter = makeAssistantStreamingFilter("paragraph");
      expect(filter(item("First"), 0)).toBeNull();
      expect(filter(item("First\n\nSec"), 10)).toMatchObject({
        turnItem: { text: "First\n\n", streaming: true, type },
      });
      expect(filter(item("First\n\nSecond\n\nThi"), 100)).toBeNull();
      expect(filter(item("First\n\nSecond\n\nThi"), 410)).toMatchObject({
        turnItem: { text: "First\n\nSecond\n\n", streaming: true },
      });
      const final = item("First\n\nSecond\n\nThird", false);
      expect(filter(final, 420)).toBe(final);

      const buffered = makeAssistantStreamingFilter("turn");
      expect(buffered(item("First\n\nSecond"), 0)).toBeNull();
      expect(buffered(final, 1)).toBe(final);
    },
  );

  it.each(["turn", "paragraph"] as const)(
    "suppresses running assistant nodes in %s mode while delivering tool and completed nodes",
    (mode) => {
      const filter = makeAssistantStreamingFilter(mode);
      const running: Extract<StreamingEvent, { type: "node.updated" }> = {
        type: "node.updated",
        node: { kind: "assistant_message", status: "running" },
      };
      expect(filter(running, 0)).toBeNull();
      const completed = { ...running, node: { ...running.node, status: "completed" as const } };
      expect(filter(completed, 1)).toBe(completed);
      const tool = { ...running, node: { ...running.node, kind: "tool_call" as const } };
      expect(filter(tool, 2)).toBe(tool);
    },
  );
});

it("holds a streamed section heading until its content has a boundary", () => {
  expect(splitBufferedAssistantText("Intro\n\n## Results\n\n")).toEqual({
    ready: "Intro\n\n",
    rest: "## Results\n\n",
  });
  expect(splitBufferedAssistantText("**Results**\n\nBody\n\nNext")).toEqual({
    ready: "**Results**\n\nBody\n\n",
    rest: "Next",
  });
});
