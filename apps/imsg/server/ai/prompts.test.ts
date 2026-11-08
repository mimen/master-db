import { describe, expect, test } from "bun:test";
import { identifyPrompt } from "./prompts";

describe("identifyPrompt", () => {
  test("renders candidates with their source", () => {
    const prompt = identifyPrompt("+15551234567", "t", [
      { source: "vault", name: "Sarah Chen", detail: "number in People/Sarah Chen.md" },
    ]);
    expect(prompt).toContain("Sarah Chen (vault)");
    expect(prompt).toContain("+15551234567");
  });

  test("names no platform's kind of address, so an email handle reads as well as a number", () => {
    const prompt = identifyPrompt("alex@example.com", "t", []);
    expect(prompt).toContain("Identify who alex@example.com is.");
    expect(prompt).not.toMatch(/number|address book|texting/i);
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
