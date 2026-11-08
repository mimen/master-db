import { describe, expect, test } from "vitest";

import { choosePrimary, gmail, handleKey, imessage, routeFor, sendRoute, slack } from "./conversationIdentity";

function dm(address: string): string {
  return imessage.conversationKey({
    isGroup: false,
    primaryChatGuid: `iMessage;-;${address}`,
    participants: [{ address, name: null }],
  });
}

describe("canonical conversation keys", () => {
  test("preserves country codes instead of matching phone suffixes", () => {
    expect(dm("+15550001111")).toBe("dm:+15550001111");
    expect(dm("+445550001111")).toBe("dm:+445550001111");
    expect(dm("(619) 555-1111 (smsfp)")).toBe("dm:+16195551111");
  });

  test("normalizes emails and preserves short codes", () => {
    expect(dm(" FRIEND@EXAMPLE.COM (rcs) ")).toBe("dm:friend@example.com");
    expect(dm("12345")).toBe("dm:12345");
    expect(dm("12345678")).toBe("dm:12345678");
    expect(dm("900080006201")).toBe("dm:900080006201");
    expect(dm("(555) 000-1111")).toBe("dm:(555) 000-1111");
  });

  test("group identity does not depend on service or participants", () => {
    for (const service of ["iMessage", "RCS", "SMS"]) {
      expect(imessage.conversationKey({
        isGroup: true,
        primaryChatGuid: `${service};+;chat123`,
        participants: [],
      })).toBe("g:chat123");
    }
  });
});

describe("choosePrimary", () => {
  test("is independent of input order on equal timestamps", () => {
    const a = { chatGuid: "SMS;-;+15550001111", lastMessageAt: 2000 };
    const b = { chatGuid: "iMessage;-;+15550001111", lastMessageAt: 2000 };
    expect(choosePrimary([a, b])).toBe("iMessage;-;+15550001111");
    expect(choosePrimary([b, a])).toBe("iMessage;-;+15550001111");
  });

  test("newest activity wins over service preference", () => {
    expect(
      choosePrimary([
        { chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1000 },
        { chatGuid: "SMS;-;+15550001111", lastMessageAt: 3000 },
      ]),
    ).toBe("SMS;-;+15550001111");
  });
});

describe("handleKey", () => {
  test("names the same dm key a one-to-one chat with that handle has", () => {
    expect(handleKey("(619) 555-1111 (smsfp)")).toBe(dm("+16195551111"));
    expect(handleKey(" Friend@Example.com ")).toBe(dm("friend@example.com"));
  });
});

describe("routes", () => {
  const conversation = { primaryChatGuid: "SMS;-;+15550001111", chatGuids: ["RCS;-;+15550001111", "SMS;-;+15550001111", "iMessage;-;+15550001111"] };

  test("a conversation sends through its primary chat", () => {
    expect(sendRoute(conversation)).toEqual({ platform: "imessage", chatGuid: "SMS;-;+15550001111" });
    expect(routeFor(conversation)).toEqual(sendRoute(conversation));
  });

  test("asked for a service, the primary wins if it carries it, else the best sibling that does", () => {
    expect(routeFor(conversation, "SMS")).toEqual({ platform: "imessage", chatGuid: "SMS;-;+15550001111" });
    expect(routeFor(conversation, "iMessage")).toEqual({ platform: "imessage", chatGuid: "iMessage;-;+15550001111" });
    expect(routeFor({ primaryChatGuid: "iMessage;-;+15550001111", chatGuids: ["SMS;-;+15550001111", "RCS;-;+15550001111", "iMessage;-;+15550001111"] }, "SMS"))
      .toEqual({ platform: "imessage", chatGuid: "RCS;-;+15550001111" });
    expect(routeFor({ primaryChatGuid: "iMessage;-;a@b.c", chatGuids: ["iMessage;-;a@b.c"] }, "SMS")).toBeNull();
  });

  test("RCS sends show as SMS", () => {
    expect(imessage.sendService("RCS;-;+15550001111")).toBe("SMS");
    expect(imessage.sendService("iMessage;+;chat1")).toBe("iMessage");
  });
});

test("a conversation with no iMessage chat has no route rather than a made-up one", () => {
  expect(() => sendRoute({})).toThrow("Conversation has no iMessage chat");
  expect(() => routeFor({}, "SMS")).toThrow("Conversation has no iMessage chat");
});

describe("slack", () => {
  test("keys a DM, a group DM, a channel and a thread apart, and kinds them", () => {
    const refs = [
      { type: "im", channel: "D1" }, { type: "mpim", channel: "G1" }, { type: "channel", channel: "C1" },
      { type: "thread", channel: "C1", threadTs: "1700000000.000100" },
    ] as const;
    expect(refs.map((ref) => [slack.conversationKey(ref), slack.kind(ref)])).toEqual([
      ["im:D1", "dm"], ["mpim:G1", "group"], ["ch:C1", "channel"], ["th:C1:1700000000.000100", "thread"],
    ]);
  });

  test("a Slack conversation routes through its channel and thread, and has no iMessage service", () => {
    const conversation = { platform: "slack" as const, accountId: "acct" as never, slack: { channel: "C1", threadTs: "1.0" } };
    expect(sendRoute(conversation)).toEqual({ platform: "slack", accountId: "acct", channel: "C1", threadTs: "1.0" });
    expect(routeFor(conversation)).toEqual(sendRoute(conversation));
    expect(routeFor(conversation, "SMS")).toBeNull();
    expect(() => sendRoute({ platform: "slack" })).toThrow("Slack conversation has no channel");
  });
});

describe("gmail", () => {
  test("a thread is one emailThread conversation, keyed by its thread id, routed through it", () => {
    expect([gmail.conversationKey("18c2a"), gmail.kind()]).toEqual(["t:18c2a", "emailThread"]);
    const conversation = { platform: "gmail" as const, accountId: "acct" as never, gmail: { threadId: "18c2a" } };
    expect(sendRoute(conversation)).toEqual({ platform: "gmail", accountId: "acct", threadId: "18c2a" });
    expect(routeFor(conversation, "iMessage")).toBeNull();
    expect(() => sendRoute({ platform: "gmail" })).toThrow("Gmail conversation has no thread");
  });
});
