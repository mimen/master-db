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

  test("refuses every write with the coming-soon reason, and lets a read through", () => {
    expect(unsupportedReason(slack, false, { kind: "send", text: "hi" })).toBe("Sending from Slack is coming");
    expect(unsupportedReason(slack, false, { kind: "react", messageGuid: "D1:1.0", reaction: "emoji:🔥", remove: false })).toBe("Sending from Slack is coming");
    expect(unsupportedReason(slack, false, { kind: "markRead" })).toBeNull();
  });
});
