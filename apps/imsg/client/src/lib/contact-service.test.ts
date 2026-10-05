import { expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { contactService, splitPrefix } from "./contact-service";

const chat = (guid: string, address: string, isGroup = false): ChatSummary =>
  ({ guid, isGroup, participants: [{ address, name: null }] }) as unknown as ChatSummary;

test("the service comes from the existing one-to-one chat with that handle", () => {
  const chats = [chat("SMS;-;+16195550103", "+16195550103"), chat("iMessage;-;+16195550101", "+16195550101")];
  expect(contactService("(619) 555-0103", chats)).toBe("SMS");
  expect(contactService("+16195550101", chats)).toBe("iMessage");
});

test("a group membership says nothing; an email is always iMessage; otherwise unknown", () => {
  const chats = [chat("SMS;+;group", "+16195550104", true)];
  expect(contactService("+16195550104", chats)).toBeNull();
  expect(contactService("a@b.example", null)).toBe("iMessage");
});

test("splitPrefix isolates the typed prefix, case-insensitively", () => {
  expect(splitPrefix("Jordan Kim", "jo")).toEqual({ match: "Jo", rest: "rdan Kim" });
  expect(splitPrefix("Alex", "jo")).toEqual({ match: "", rest: "Alex" });
  expect(splitPrefix("Alex", "  ")).toEqual({ match: "", rest: "Alex" });
});
