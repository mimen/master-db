import { describe, expect, test } from "bun:test";
import type { ReplySuggestion } from "@shared/types";
import { alternateIndexForKey, suggestionSlots } from "./suggestion-slots";

const suggestion = (id: string, kind: "text" | "reaction" = "text"): ReplySuggestion => ({
  id, kind, strategy: "clarify", vibe: "curious", text: id, reaction: kind === "reaction" ? "like" : null,
  targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null,
});

const base = {
  enabled: true, awaitingReply: true, mode: "auto" as const, resolved: true, loading: false, failed: false,
  showSkeleton: false, stale: false, suggestions: [] as ReplySuggestion[], hasEvent: false,
};

describe("suggestionSlots", () => {
  test("the first text suggestion is the ghost and the rest are alternates in order", () => {
    const react = suggestion("thumbs", "reaction");
    const slots = suggestionSlots({ ...base, suggestions: [react, suggestion("a"), suggestion("b")] });
    expect(slots).toEqual({ kind: "ready", ghost: suggestion("a"), alternates: [react, suggestion("b")], stale: false });
  });

  test("a stale set shows no ghost and offers every suggestion as an alternate", () => {
    const slots = suggestionSlots({ ...base, stale: true, suggestions: [suggestion("a"), suggestion("b")] });
    expect(slots).toEqual({ kind: "ready", ghost: null, alternates: [suggestion("a"), suggestion("b")], stale: true });
  });

  test("alternates stop at three", () => {
    const slots = suggestionSlots({ ...base, suggestions: ["a", "b", "c", "d", "e"].map((id) => suggestion(id)) });
    expect(slots.kind === "ready" && slots.alternates.map((s) => s.id)).toEqual(["b", "c", "d"]);
  });

  test("Off and a conversation not awaiting a reply show nothing", () => {
    expect(suggestionSlots({ ...base, mode: "off", suggestions: [suggestion("a")] })).toEqual({ kind: "hidden" });
    expect(suggestionSlots({ ...base, awaitingReply: false, suggestions: [suggestion("a")] })).toEqual({ kind: "hidden" });
  });

  test("on demand offers a request until one runs, then reports failure or placeholders", () => {
    expect(suggestionSlots({ ...base, mode: "on-demand", resolved: false })).toEqual({ kind: "offer" });
    expect(suggestionSlots({ ...base, mode: "on-demand", resolved: false, failed: true })).toEqual({ kind: "failed" });
    expect(suggestionSlots({ ...base, loading: true })).toEqual({ kind: "hidden" });
    expect(suggestionSlots({ ...base, loading: true, showSkeleton: true })).toEqual({ kind: "loading" });
  });

  test("an empty answer hides the slots unless a calendar event came with it", () => {
    expect(suggestionSlots(base)).toEqual({ kind: "hidden" });
    expect(suggestionSlots({ ...base, hasEvent: true })).toEqual({ kind: "ready", ghost: null, alternates: [], stale: false });
  });
});

describe("alternateIndexForKey", () => {
  const key = (code: string, mods: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) =>
    alternateIndexForKey({ altKey: true, metaKey: false, ctrlKey: false, code, ...mods });

  test("⌥1 to ⌥3 pick alternates by physical key", () => {
    expect([key("Digit1"), key("Digit2"), key("Digit3")]).toEqual([0, 1, 2]);
  });

  test("other digits, missing Option, or extra modifiers are not alternates", () => {
    expect(key("Digit4")).toBeNull();
    expect(key("Digit1", { altKey: false })).toBeNull();
    expect(key("Digit1", { metaKey: true })).toBeNull();
    expect(key("KeyA")).toBeNull();
  });
});
