import { describe, expect, test } from "bun:test";
import {
  createdChatError,
  messageBelongsToAnyChat,
  normalizeSendAddress,
  outboundAddressesError,
  outboundTextError,
  selectCreatedChatMessage,
} from "./message-verification";

describe("selectCreatedChatMessage", () => {
  test("selects only the outgoing message with the matching temp GUID and text", () => {
    const expected = {
      guid: "sent",
      tempGuid: "temp-1",
      text: "Hello",
      isFromMe: true,
    };
    const chat = {
      guid: "chat-1",
      messages: [
        { guid: "old", tempGuid: "temp-1", text: "Old", isFromMe: true },
        { guid: "inbound", tempGuid: "temp-1", text: "Hello", isFromMe: false },
        expected,
      ],
    };

    expect(selectCreatedChatMessage(chat, "temp-1", "Hello")).toEqual(expected);
  });

  test("fails closed when the response omits the matching message", () => {
    expect(selectCreatedChatMessage({ guid: "chat-1", messages: [] }, "temp-1", "Hello")).toBeNull();
  });
});

describe("createdChatError", () => {
  const sent = { guid: "m1", isFromMe: true, text: "Hello" };

  test("accepts an exact one-to-one iMessage recipient", () => {
    expect(createdChatError({
      guid: "iMessage;-;+15550001111",
      participants: [{ address: "+1 (555) 000-1111" }],
    }, ["+15550001111"], sent)).toBeNull();
  });

  test("accepts an exact iMessage group recipient set", () => {
    expect(createdChatError({
      guid: "iMessage;+;group-1",
      participants: [{ address: "a@example.com" }, { address: "+15550001111" }],
    }, ["+15550001111", "A@example.com"], sent)).toBeNull();
  });

  test("rejects duplicate-normalized recipients before mutation", () => {
    expect(outboundAddressesError(["+15550001111", "+1 (555) 000-1111"]))
      .toBe("duplicate recipient addresses");
    expect(createdChatError({
      guid: "iMessage;+;group-1",
      participants: [{ address: "+15550001111" }, { address: "+15550002222" }],
    }, ["+15550001111", "+1 (555) 000-1111"], sent)).toContain("invalid recipients");
  });

  test("rejects wrong service, chat shape, and participants", () => {
    expect(createdChatError({
      guid: "SMS;-;+15550001111",
      participants: [{ address: "+15550001111" }],
    }, ["+15550001111"], sent)).toContain("not a one-to-one iMessage chat");
    expect(createdChatError({
      guid: "iMessage;+;group-1",
      participants: [{ address: "+15550001111" }, { address: "+15550002222" }],
    }, ["+15550001111"], sent)).toContain("not a one-to-one iMessage chat");
    expect(createdChatError({
      guid: "iMessage;-;+15550002222",
      participants: [{ address: "+15550002222" }],
    }, ["+15550001111"], sent)).toContain("participants do not match");
  });

  test("normalizes only unambiguous send addresses", () => {
    expect(normalizeSendAddress("(555) 000-1111")).toBe("+15550001111");
    expect(normalizeSendAddress("A@Example.com")).toBe("a@example.com");
    expect(normalizeSendAddress("+447911123456")).toBe("+447911123456");
    expect(normalizeSendAddress("07911123456")).not.toBe("+447911123456");
  });
});

describe("outboundTextError", () => {
  test("accepts internal whitespace", () => {
    expect(outboundTextError("Hello\nthere")).toBeNull();
  });

  test("rejects empty or boundary-whitespace text before sending", () => {
    expect(outboundTextError("   ")).toBe("empty message");
    expect(outboundTextError(" Hello ")).toBe(
      "message must not have leading or trailing whitespace",
    );
  });
});

describe("messageBelongsToAnyChat", () => {
  test("accepts the exact requested chat", () => {
    const message = { guid: "m1", chats: [{ guid: "iMessage;-;+15550001111" }] };
    expect(messageBelongsToAnyChat(message, ["iMessage;-;+15550001111"])).toBe(true);
  });

  test("rejects a different service sibling", () => {
    const message = { guid: "m1", chats: [{ guid: "SMS;-;+15550001111" }] };
    expect(messageBelongsToAnyChat(message, ["iMessage;-;+15550001111"])).toBe(false);
  });

  test("rejects a message from another conversation", () => {
    const message = { guid: "m1", chats: [{ guid: "iMessage;-;+15550002222" }] };
    expect(messageBelongsToAnyChat(message, ["iMessage;-;+15550001111"])).toBe(false);
  });
});
