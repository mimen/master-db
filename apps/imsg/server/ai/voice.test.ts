import { describe, expect, test } from "bun:test";
import type { SuggestionFeedbackRow } from "../db";
import { deriveEditRules, deriveGlobalStyle } from "./voice";

function row(id: string, suggested: string, finalText: string): SuggestionFeedbackRow {
  return {
    id, chat_guid: "c", suggestion_id: id, kind: "text", strategy: "clarify", vibe: "curious",
    selected_model: "opus", served_model: "opus", recipe_version: 3,
    suggested_text: suggested, final_text: finalText, selected_at: 1, sent_at: 2,
  };
}

describe("voice profile", () => {
  test("derives aggregate style without exposing source text", () => {
    const profile = deriveGlobalStyle(["yeah i'm down", "what time", "send it over"]);
    expect(profile).toContain("Typical sent message length");
    expect(profile).not.toContain("send it over");
  });

  test("learns only recurring edit tendencies", () => {
    const rows = [
      row("1", "yeah what time works?", "what time works?"),
      row("2", "sounds good, where?", "where?"),
      row("3", "perfect, send it over", "send it over"),
    ];
    expect(deriveEditRules(rows)).toContain("Skip acknowledgment openings; lead with the useful move.");
    expect(deriveEditRules(rows.slice(0, 2))).not.toContain("Skip acknowledgment openings; lead with the useful move.");
  });
});
