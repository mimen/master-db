import { describe, expect, test } from "bun:test";
import type { Message } from "../../shared/types";
import { passesEchoGate, validateSuggestionSet } from "./suggestions";

function message(overrides: Partial<Message> = {}): Message {
  return {
    guid: "in-1", chatGuid: "chat-1", text: "we can hold september 19 but need an answer tomorrow. deposit is 50%",
    dateCreated: 1, dateRead: null, dateDelivered: null, isFromMe: false, service: "iMessage",
    sender: { address: "+1", name: "Jordan" }, attachments: [], special: null, sendEffect: null,
    reactions: [], replyToGuid: null, replyToPreview: null, replyToFromMe: null,
    isGroupEvent: false, error: 0, edited: false, retracted: false, ...overrides,
  };
}

function raw(text: string, overrides: Record<string, object | string | boolean | number | string[]> = {}): object {
  return { noReply: false, suggestions: [{
    kind: "text", strategy: "clarify", vibe: "curious", text, reaction: "none",
    targetMessageGuid: "", targetPartIndex: 0, basisMessageGuids: [],
    decisionOption: false, introducesCommitment: false, ...overrides,
  }] };
}

const options = (messages: Message[]) => ({
  messages,
  renderedGuids: new Set(messages.map((item) => item.guid)),
  reactionSuggestions: true,
  verifiedReactionGuids: new Set(messages.map((item) => item.guid)),
});

describe("semantic suggestion validation", () => {
  test("rejects acknowledgment plus inbound restatement", () => {
    expect(passesEchoGate(
      "yeah sounds good, i'll confirm september 19 tomorrow and send the 50% deposit",
      message().text,
    )).toBe(false);
  });

  test("keeps a grounded question that advances the thread", () => {
    expect(passesEchoGate("is the deposit refundable?", message().text)).toBe(true);
  });

  test("normalizes optional text-only metadata from non-schema providers", () => {
    const result = validateSuggestionSet({ noReply: false, suggestions: [{
      strategy: "clarify", text: "what time works?",
      reaction: null, targetMessageGuid: null, targetPartIndex: null,
    }] }, options([message({ text: "when are you free?" })]));
    expect(result.ok).toBe(true);
  });

  test("rejects unsupported operational commitments", () => {
    const result = validateSuggestionSet(
      raw("i'll connect you with gucci", { introducesCommitment: true }),
      options([message()]),
    );
    expect(result.ok).toBe(false);
  });

  test("accepts explicit no-reply only for a closed exchange", () => {
    const closed = message({ text: "perfect thank you!!" });
    const result = validateSuggestionSet({ noReply: true, suggestions: [] }, options([closed]));
    expect(result).toEqual({ ok: true, value: { noReply: true, suggestions: [] } });
    expect(validateSuggestionSet({ noReply: true, suggestions: [{}] }, options([closed])).ok).toBe(false);
    expect(validateSuggestionSet({ noReply: true, suggestions: [] }, options([message({ text: "wya" })])).ok).toBe(false);
  });

  test("rejects copied facts disguised as a question", () => {
    expect(passesEchoGate("september 19?", message().text)).toBe(false);
  });

  test("rejects fabricated decisions, commitments, and people", () => {
    const unrelatedInbound = message({ text: "the event is next week" });
    expect(validateSuggestionSet(raw("yes, let us do it", {
      strategy: "answer", decisionOption: true,
    }), options([unrelatedInbound])).ok).toBe(false);

    const outbound = message({ guid: "out-1", isFromMe: true, text: "the venue is downtown", sender: null });
    expect(validateSuggestionSet(raw("i will send the venue", {
      strategy: "advance", basisMessageGuids: [outbound.guid], introducesCommitment: true,
    }), options([outbound, message({ text: "can you send it?" })])).ok).toBe(false);

    expect(validateSuggestionSet(raw("should i ask sarah?"), options([message({ text: "who should handle this?" })])).ok).toBe(false);
  });

  test("rejects an unrelated outbound citation for a fabricated commitment", () => {
    const outbound = message({ guid: "out-1", isFromMe: true, text: "sounds good", sender: null });
    const result = validateSuggestionSet(raw("yes, i will send 999 tomorrow", {
      strategy: "answer", basisMessageGuids: [outbound.guid], decisionOption: true, introducesCommitment: true,
    }), options([outbound, message()]));
    expect(result.ok).toBe(false);
  });

  test("rejects duplicate existing tapbacks", () => {
    const target = message({ reactions: [{ type: "like", isFromMe: true, senderName: null, senderAddress: null }] });
    const result = validateSuggestionSet({ noReply: false, suggestions: [{
      kind: "reaction", strategy: "react", vibe: "affirmative", text: "thumbs up",
      reaction: "like", targetMessageGuid: target.guid, targetPartIndex: 0,
      basisMessageGuids: [target.guid], decisionOption: false, introducesCommitment: false,
    }] }, options([target]));
    expect(result.ok).toBe(false);
  });
});
