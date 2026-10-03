import { describe, expect, test } from "vitest";

import { conversationKey } from "./conversationKey";

function dm(address: string): string {
  return conversationKey({
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
      expect(conversationKey({
        isGroup: true,
        primaryChatGuid: `${service};+;chat123`,
        participants: [],
      })).toBe("g:chat123");
    }
  });
});
