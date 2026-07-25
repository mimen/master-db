import { describe, expect, test } from "bun:test";

import { chatIsSMS } from "./chat-service";

describe("chatIsSMS", () => {
  test("RCS chats are green — the regression this function existed to miss", () => {
    // RCS was the actual bug: 53 of the 69 green chats carry this prefix, and
    // every optimistic send in them rendered blue before snapping green.
    expect(chatIsSMS("RCS;-;+16199813959")).toBe(true);
    expect(chatIsSMS("RCS;+;group-1")).toBe(true);
  });

  test("SMS chats are green", () => {
    expect(chatIsSMS("SMS;-;+15550001111")).toBe(true);
    expect(chatIsSMS("SMS;+;group-1")).toBe(true);
  });

  test("iMessage chats are not", () => {
    expect(chatIsSMS("iMessage;-;+15550001111")).toBe(false);
    expect(chatIsSMS("iMessage;+;chat123")).toBe(false);
  });
});
