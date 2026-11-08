import { describe, expect, test } from "vitest";

import { unsupportedReason } from "./routeSupport";

const sms = { platform: "imessage" as const, chatGuid: "SMS;-;+15550001111" };
const imessage = { platform: "imessage" as const, chatGuid: "iMessage;-;+15550001111" };

describe("unsupportedReason", () => {
  test("a plain send passes everywhere; a reply or a mention needs iMessage", () => {
    expect(unsupportedReason(sms, false, { kind: "send", text: "hi" })).toBeNull();
    expect(unsupportedReason(sms, false, { kind: "send", text: "hi", replyToGuid: "m" })).toBe("SMS can't reply to a message");
    const mention = { kind: "send" as const, text: "@Sam", mentions: [{ start: 0, length: 4, address: "+15550002222" }] };
    expect(unsupportedReason({ ...sms, chatGuid: "SMS;+;g" }, true, mention)).toBe("SMS can't mention people");
    expect(unsupportedReason({ ...imessage, chatGuid: "iMessage;+;g" }, true, mention)).toBeNull();
  });

  test("RCS shares SMS's limits under its own name", () => {
    expect(unsupportedReason({ platform: "imessage", chatGuid: "RCS;-;+15550001111" }, false, { kind: "unsend", messageGuid: "m" }))
      .toBe("RCS can't unsend messages");
  });

  test("cancelling a scheduled message and reading never consult the profile", () => {
    expect(unsupportedReason(sms, false, { kind: "cancelScheduled", bbId: 1 })).toBeNull();
    expect(unsupportedReason(sms, false, { kind: "markRead" })).toBeNull();
    expect(unsupportedReason(sms, false, { kind: "suggestions", model: "opus", refresh: false })).toBeNull();
  });
});

describe("a Slack route", () => {
  const slack = { platform: "slack" as const, accountId: "a" as never, channel: "D1" };

  test("runs what Comma sends to Slack, refuses what it does not yet, and lets a read through", () => {
    expect(unsupportedReason(slack, false, { kind: "send", text: "hi", replyToGuid: "D1:1.0" })).toBeNull();
    expect(unsupportedReason(slack, false, { kind: "react", messageGuid: "D1:1.0", reaction: "emoji:🔥", remove: false })).toBeNull();
    expect(unsupportedReason(slack, false, { kind: "edit", messageGuid: "D1:1.0", text: "x" })).toBeNull();
    expect(unsupportedReason(slack, false, { kind: "unsend", messageGuid: "D1:1.0" })).toBeNull();
    expect(unsupportedReason(slack, false, { kind: "react", messageGuid: "D1:1.0", reaction: "love", remove: false })).toBe("Slack can't send that reaction");
    expect(unsupportedReason(slack, false, { kind: "delete", messageGuid: "D1:1.0" })).toBe("Slack can't delete a message just for you");
    expect(unsupportedReason(slack, false, { kind: "schedule", text: "hi", sendAt: 1 })).toBe("Not in Comma's Slack yet");
    expect(unsupportedReason(slack, false, { kind: "markRead" })).toBeNull();
    expect(unsupportedReason(slack, false, { kind: "suggestions", model: "opus", refresh: false })).toBeNull();
    expect(unsupportedReason(imessage, false, { kind: "suggestions", model: "opus", refresh: false })).toBeNull();
  });
});

describe("a Gmail route", () => {
  const gmail = { platform: "gmail" as const, accountId: "a" as never, threadId: "t1" };

  test("is read-only: sending and model replies wait for G2 with the reason, a read passes", () => {
    expect(unsupportedReason(gmail, true, { kind: "send", text: "hi" })).toBe("Sending from Gmail is coming");
    expect(unsupportedReason(gmail, true, { kind: "suggestions", model: "opus", refresh: false })).toBe("Sending from Gmail is coming");
    expect(unsupportedReason(gmail, true, { kind: "react", messageGuid: "m", reaction: "emoji:🔥", remove: false })).toBe("Gmail can't send emoji reactions");
    expect(unsupportedReason(gmail, true, { kind: "markRead" })).toBeNull();
  });
});
