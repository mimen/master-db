import { expect, test } from "bun:test";
import {
  addressesMatch,
  emailMatchKey,
  formatAddress,
  formatPhone,
  matchesAnyAddress,
  phoneMatchKey,
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

test("phoneMatchKey is the last-10-digit suffix regardless of formatting", () => {
  expect(phoneMatchKey("+16195551234")).toBe("6195551234");
  expect(phoneMatchKey("(619) 555-1234")).toBe("6195551234");
  expect(phoneMatchKey("6195551234")).toBe("6195551234");
});

test("phoneMatchKey returns empty for anything too short to be a confident match", () => {
  expect(phoneMatchKey("12345")).toBe("");
  expect(phoneMatchKey("24273(smsfp)")).toBe("");
});

test("emailMatchKey lowercases; empty for non-email addresses", () => {
  expect(emailMatchKey("Jane@Example.com")).toBe("jane@example.com");
  expect(emailMatchKey("+16195551234")).toBe("");
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
