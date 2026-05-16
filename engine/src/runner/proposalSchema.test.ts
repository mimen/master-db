import { describe, expect, test } from "vitest";

import { ProposalSchema } from "./proposalSchema";

describe("ProposalSchema", () => {
  test("accepts a minimal proposal", () => {
    const p = ProposalSchema.parse({
      kind: "proposal",
      summary: "hello",
      options: [],
      free_text_allowed: true,
    });
    expect(p.kind).toBe("proposal");
  });

  test("accepts a clarification with question + options", () => {
    const p = ProposalSchema.parse({
      kind: "clarification",
      summary: "I need to know",
      question: "Which project?",
      options: [
        {
          id: "a",
          label: "Inbox",
          description: "Top-level inbox",
          confidence: 0.8,
          reversibility: "trivial",
        },
      ],
      free_text_allowed: true,
    });
    expect(p.options[0].confidence).toBe(0.8);
  });

  test("rejects unknown kind", () => {
    expect(() =>
      ProposalSchema.parse({
        kind: "nope",
        summary: "x",
        options: [],
        free_text_allowed: false,
      }),
    ).toThrow();
  });

  test("rejects confidence out of range", () => {
    expect(() =>
      ProposalSchema.parse({
        kind: "proposal",
        summary: "x",
        options: [
          {
            id: "a",
            label: "a",
            description: "a",
            confidence: 1.5,
            reversibility: "trivial",
          },
        ],
        free_text_allowed: false,
      }),
    ).toThrow();
  });
});
