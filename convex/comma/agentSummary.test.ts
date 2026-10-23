import { describe, expect, test } from "vitest";

import type { AgentEntry } from "../schema/comma/validators";

import { askTitle, chatPreview } from "./agentSummary";

const user = (text: string): AgentEntry => ({ kind: "user", text, steer: false });
const assistant = (text: string): AgentEntry => ({ kind: "assistant", text, streaming: false });
const thinking = (text: string): AgentEntry => ({ kind: "thinking", text, streaming: true });
const draft = (text: string): AgentEntry => ({ kind: "draft", text, placed: "composer", used: false });
const question = (text: string, status: "pending" | "resolved" = "pending"): AgentEntry =>
  ({ kind: "question", requestId: text, status, questions: [{ question: text, multiSelect: false, options: [] }, { question: "second", multiSelect: false, options: [] }] });
const end = (outcome: "completed" | "failed", error?: string): AgentEntry => ({ kind: "turn_end", outcome, ...(error ? { error } : {}) });

describe("chatPreview", () => {
  test("a waiting chat shows its newest pending question's first question", () => {
    const items = [question("Which list?"), question("Old one?", "resolved"), assistant("Looking"), user("add them")];
    expect(chatPreview(items, "waiting_input")).toEqual({ kind: "question", text: "Which list?" });
  });

  test("a failed chat shows the last turn's error", () => {
    expect(chatPreview([end("failed", "Gateway timed out"), assistant("partial"), user("go")], "failed"))
      .toEqual({ kind: "error", text: "Gateway timed out" });
  });

  test("a finished turn shows its draft over its reply", () => {
    expect(chatPreview([end("completed"), assistant("Drafted it."), draft("See you at 8"), user("draft a yes")], "idle"))
      .toEqual({ kind: "draft", text: "See you at 8" });
  });

  test("a draft from an earlier turn gives way to the newest reply", () => {
    const items = [end("completed"), assistant("Friday works."), user("is friday ok"), end("completed"), draft("Old draft"), user("draft")];
    expect(chatPreview(items, "idle")).toEqual({ kind: "reply", text: "Friday works." });
  });

  test("a running turn shows its newest thought or text, never the last turn's reply", () => {
    expect(chatPreview([thinking("**Reading** the thread"), user("next"), assistant("Earlier reply")], "running"))
      .toEqual({ kind: "thinking", text: "**Reading** the thread" });
    expect(chatPreview([assistant("Writing now"), thinking("plan"), user("next")], "running")).toEqual({ kind: "thinking", text: "Writing now" });
    expect(chatPreview([user("next"), assistant("Earlier reply")], "pending")).toBeUndefined();
  });

  test("an interrupted chat shows its reply, and a fresh chat shows nothing", () => {
    expect(chatPreview([end("completed"), assistant("Half an answer"), user("go")], "interrupted")).toEqual({ kind: "reply", text: "Half an answer" });
    expect(chatPreview([user("hi")], "idle")).toBeUndefined();
  });

  test("text is trimmed and clipped to 200 characters", () => {
    const preview = chatPreview([assistant(`  ${"word ".repeat(80)}  `)], "idle");
    expect(preview?.text.length).toBeLessThanOrEqual(200);
    expect(preview?.text).toMatch(/^word word.*…$/);
  });
});

describe("askTitle", () => {
  test("puts the first ask on one line, clipped to 48 characters", () => {
    expect(askTitle("  Add Jesse and\nRebecca  ")).toBe("Add Jesse and Rebecca");
    const long = askTitle("Find every message where we talked about the Halloween guest list");
    expect(long.length).toBe(48);
    expect(long.endsWith("…")).toBe(true);
  });

  test("an ask with only attachments still gets a title", () => {
    expect(askTitle("")).toBe("Agent chat");
  });
});
