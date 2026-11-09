import { describe, expect, test } from "bun:test";
import type { ConversationId } from "./types";
import {
  addressesMatch,
  disambiguators,
  type HandleTiebreak,
  formatAddress,
  formatPhone,
  handleMatchKey,
  matchesAnyAddress,
  normalizeHandle,
  parseHandle,
  stripServiceSuffix,
} from "./address";

test("strips BlueBubbles service suffixes", () => {
  expect(stripServiceSuffix("+12693974034(smsfp)")).toBe("+12693974034");
  expect(stripServiceSuffix("24273(smsfp)")).toBe("24273");
  expect(stripServiceSuffix("+12693974034")).toBe("+12693974034");
});

test("does not strip parens from real names", () => {
  expect(stripServiceSuffix("Kimberly (Morris) Farthing")).toBe("Kimberly (Morris) Farthing");
});

test("formats US phone numbers", () => {
  expect(formatPhone("+12693974034")).toBe("(269) 397-4034");
  expect(formatPhone("2693974034")).toBe("(269) 397-4034");
});

test("formatAddress cleans and prettifies", () => {
  expect(formatAddress("+12693974034(smsfp)")).toBe("(269) 397-4034");
  expect(formatAddress("24273(smsfp)")).toBe("24273"); // short code untouched
  expect(formatAddress("jane@example.com")).toBe("jane@example.com");
});

test("parseHandle decides each address's kind once", () => {
  expect(parseHandle("+12693974034(smsfp)")).toEqual({ kind: "phone", address: "+12693974034" });
  expect(parseHandle("24273")).toEqual({ kind: "phone", address: "24273" });
  expect(parseHandle("Jane@Example.com")).toEqual({ kind: "email", address: "Jane@Example.com" });
  expect(parseHandle("slack:U06195551234")).toEqual({ kind: "slack", address: "slack:U06195551234" });
  expect(parseHandle("tel:+12693974034")).toBeNull();
  expect(parseHandle("")).toBeNull();
});

// The shapes production's participants, senders and identities carry (2026-11-07, read-only): E.164, bare 10 and 11
// digits, formatted US numbers, international without a plus, short codes, suffixed SMS lines, RCS business ids,
// emails. Each keeps the key it had before handle kinds.
const REAL_SHAPES: [address: string, matchKey: string, normalized: string, display: string][] = [
  ["+16195551234", "6195551234", "+16195551234", "(619) 555-1234"],
  ["+16195551234(smsfp)", "6195551234", "+16195551234", "(619) 555-1234"],
  ["6195551234", "6195551234", "+16195551234", "(619) 555-1234"],
  ["16195551234", "6195551234", "+16195551234", "(619) 555-1234"],
  ["(619) 555-1234", "6195551234", "+16195551234", "(619) 555-1234"],
  ["+1 619-555-1234", "6195551234", "+16195551234", "(619) 555-1234"],
  ["1 (619) 555-1234", "6195551234", "+16195551234", "(619) 555-1234"],
  ["+447911123456", "7911123456", "+447911123456", "+447911123456"],
  ["447911123456", "7911123456", "+447911123456", "447911123456"],
  ["24273", "", "", "24273"],
  ["24273(smsfp)", "", "", "24273"],
  ["898287", "", "", "898287"],
  ["Jane@Example.com", "jane@example.com", "jane@example.com", "Jane@Example.com"],
  ["jane1990@icloud.com", "jane1990@icloud.com", "jane1990@icloud.com", "jane1990@icloud.com"],
  ["store_brand_agent@rbm.goog(smsfp)", "store_brand_agent@rbm.goog", "store_brand_agent@rbm.goog", "store_brand_agent@rbm.goog"],
];

test.each(REAL_SHAPES)("%p keeps its match key, identity key and display", (address, matchKey, normalized, display) => {
  expect(handleMatchKey(address)).toBe(matchKey);
  expect(normalizeHandle(address)).toBe(normalized);
  expect(formatAddress(address)).toBe(display);
});

test("a Slack id is never a phone number, and shows as a placeholder until a name resolves", () => {
  expect(handleMatchKey("slack:U06195551234")).toBe("slack:U06195551234");
  expect(normalizeHandle("slack:U06195551234")).toBe("slack:U06195551234");
  expect(addressesMatch("slack:U06195551234", "+16195551234")).toBe(false);
  expect(addressesMatch("slack:U06195551234", "slack:U06195551234")).toBe(true);
  expect(formatAddress("slack:U06195551234")).toBe("Slack user");
});

test("an email whose name holds digits matches only that email, not a phone", () => {
  expect(addressesMatch("jane6195551234@icloud.com", "+16195551234")).toBe(false);
  expect(addressesMatch("Jane@Example.com", "jane@example.com")).toBe(true);
});

test("addressesMatch: same phone via different formatting", () => {
  expect(addressesMatch("+16195551234", "(619) 555-1234")).toBe(true);
  expect(addressesMatch("+16195551234", "+16195559999")).toBe(false);
});

test("addressesMatch: same email, case-insensitive", () => {
  expect(addressesMatch("Jane@Example.com", "jane@example.com")).toBe(true);
  expect(addressesMatch("jane@example.com", "john@example.com")).toBe(false);
});

test("addressesMatch: a phone never matches an email and vice versa", () => {
  expect(addressesMatch("+16195551234", "jane@example.com")).toBe(false);
});

test("addressesMatch: two too-short/unmatchable addresses never match each other", () => {
  expect(addressesMatch("12345", "12345")).toBe(false);
});

test("matchesAnyAddress checks a candidate against a whole list", () => {
  const known = ["+16195551234", "jane@example.com"];
  expect(matchesAnyAddress("(619) 555-1234", known)).toBe(true);
  expect(matchesAnyAddress("Jane@Example.com", known)).toBe(true);
  expect(matchesAnyAddress("+19995551234", known)).toBe(false);
  expect(matchesAnyAddress("anything", [])).toBe(false);
});

describe("disambiguators", () => {
  const dm = (guid: string, displayName: string, address: string) =>
    ({ conversationId: `c-${guid}` as ConversationId, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: guid } }, displayName, isGroup: false, participants: [{ address, name: displayName }] });
  test("marks DMs whose name repeats on one service with their handle's kind; a name repeated across services needs none", () => {
    const chats = [
      dm("iMessage;-;+19259976370", "Sprout Imen", "+19259976370"),
      dm("SMS;-;+19253759404", "Sprout Imen", "+19253759404"),
      dm("iMessage;-;miladmaaan@gmail.com", "Sprout Imen", "miladmaaan@gmail.com"),
      dm("iMessage;-;+16195550101", "Alex Rivera", "+16195550101"),
      dm("SMS;-;+16195550101", "Alex Rivera", "+16195550101"),
    ];
    expect(disambiguators(chats)).toEqual(new Map<ConversationId, HandleTiebreak>([
      ["c-iMessage;-;+19259976370" as ConversationId, { kind: "phone", address: "(925) 997-6370" }],
      ["c-iMessage;-;miladmaaan@gmail.com" as ConversationId, { kind: "email", address: "miladmaaan@gmail.com" }],
    ]));
  });

  test("leaves groups alone, and ignores a name that repeats only across a group and a DM", () => {
    const group = { conversationId: "c-crew" as ConversationId, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;+;crew" } }, displayName: "Alex Rivera", isGroup: true, participants: [] };
    expect(disambiguators([group, dm("iMessage;-;+16195550101", "Alex Rivera", "+16195550101")])).toEqual(new Map());
  });
});
