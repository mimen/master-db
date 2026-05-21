import { describe, expect, test } from "vitest";

import {
  dropRedundantClarificationOptions,
  ProposalSchema,
  type Proposal,
} from "./proposalSchema";

function clar(labels: string[]): Proposal {
  return {
    kind: "clarification",
    summary: "s",
    question: "Who?",
    free_text_allowed: true,
    options: labels.map((label, i) => ({
      id: String(i),
      label,
      description: "",
      confidence: 0.5,
      reversibility: "trivial",
    })),
  };
}

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

  test("accepts proposal with urgency + urgency_reasoning", () => {
    const p = ProposalSchema.parse({
      kind: "proposal",
      summary: "x",
      options: [],
      free_text_allowed: false,
      urgency: 0.85,
      urgency_reasoning: "due tomorrow",
    });
    expect(p.urgency).toBe(0.85);
    expect(p.urgency_reasoning).toBe("due tomorrow");
  });

  test("accepts proposal without urgency fields (rollout tolerance)", () => {
    const p = ProposalSchema.parse({
      kind: "proposal",
      summary: "x",
      options: [],
      free_text_allowed: false,
    });
    expect(p.urgency).toBeUndefined();
    expect(p.urgency_reasoning).toBeUndefined();
  });

  test("rejects urgency > 1", () => {
    expect(() =>
      ProposalSchema.parse({
        kind: "proposal",
        summary: "x",
        options: [],
        free_text_allowed: false,
        urgency: 1.1,
      }),
    ).toThrow();
  });

  test("rejects urgency < 0", () => {
    expect(() =>
      ProposalSchema.parse({
        kind: "proposal",
        summary: "x",
        options: [],
        free_text_allowed: false,
        urgency: -0.1,
      }),
    ).toThrow();
  });

  test("accepts urgency without urgency_reasoning", () => {
    const p = ProposalSchema.parse({
      kind: "proposal",
      summary: "x",
      options: [],
      free_text_allowed: false,
      urgency: 0.4,
    });
    expect(p.urgency).toBe(0.4);
    expect(p.urgency_reasoning).toBeUndefined();
  });
});

describe("dropRedundantClarificationOptions", () => {
  test("drops 'I'll tell you' / meta-answer chips, keeps concrete ones", () => {
    const out = dropRedundantClarificationOptions(
      clar(["A potential investor", "I'll tell you who", "An artist I'm booking"]),
    );
    expect(out.options.map((o) => o.label)).toEqual([
      "A potential investor",
      "An artist I'm booking",
    ]);
  });

  test("drops 'Other' and 'Something else'", () => {
    const out = dropRedundantClarificationOptions(clar(["Inbox", "Other", "Something else"]));
    expect(out.options.map((o) => o.label)).toEqual(["Inbox"]);
  });

  test("no-op when all options are concrete (returns same reference)", () => {
    const p = clar(["Inbox", "Funding"]);
    expect(dropRedundantClarificationOptions(p)).toBe(p);
  });

  test("does not touch non-clarification proposals", () => {
    const p: Proposal = { ...clar(["Other"]), kind: "proposal" };
    expect(dropRedundantClarificationOptions(p).options).toHaveLength(1);
  });

  test("does not over-match concrete answers containing 'other' mid-word", () => {
    const out = dropRedundantClarificationOptions(clar(["My brother Sam", "Another vendor"]));
    expect(out.options).toHaveLength(2);
  });
});
