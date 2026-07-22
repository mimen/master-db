import { describe, expect, test } from "bun:test";
import { groupNamePrompt, identifyPrompt, replySuggestionPrompt } from "./prompts";

describe("groupNamePrompt", () => {
  test("includes participants and transcript", () => {
    const prompt = groupNamePrompt("Sarah: <message>yo</message>", ["Sarah", "Dan"]);
    expect(prompt).toContain("Sarah, Dan");
    expect(prompt).toContain("yo");
    expect(prompt).toContain("JSON array");
  });

  test("carries the untrusted-content notice", () => {
    expect(groupNamePrompt("", [])).toContain("written by other people");
  });

  test("degrades gracefully with no messages or participants", () => {
    const prompt = groupNamePrompt("", []);
    expect(prompt).toContain("(no messages yet)");
    expect(prompt).toContain("unknown");
  });
});

describe("replySuggestionPrompt", () => {
  test("includes the profile when present and omits the header when not", () => {
    expect(replySuggestionPrompt("t", "Milad runs AUF.", "Sarah")).toContain("About Milad:");
    expect(replySuggestionPrompt("t", "", "Sarah")).not.toContain("About Milad:");
  });

  test("names the peer when known", () => {
    expect(replySuggestionPrompt("t", "", "Sarah")).toContain("to Sarah");
    expect(replySuggestionPrompt("t", "", null)).toContain("Draft replies Milad could send.");
  });

  test("states the voice constraints", () => {
    const prompt = replySuggestionPrompt("t", "", null);
    expect(prompt).toContain("No exclamation marks");
    expect(prompt).toContain("Never invent commitments");
  });
});

describe("identifyPrompt", () => {
  test("renders candidates with their source", () => {
    const prompt = identifyPrompt("+15551234567", "t", [
      { source: "vault", name: "Sarah Chen", detail: "number in People/Sarah Chen.md" },
    ]);
    expect(prompt).toContain("Sarah Chen (vault)");
    expect(prompt).toContain("+15551234567");
  });

  test("says so explicitly when no candidates were found", () => {
    expect(identifyPrompt("+1555", "t", [])).toContain("(no matches found in any source)");
  });

  test("requests the structured identity shape", () => {
    const prompt = identifyPrompt("+1555", "t", []);
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"reasoning"');
  });
});
