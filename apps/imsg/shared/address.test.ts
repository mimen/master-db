import { expect, test } from "bun:test";
import { formatAddress, formatPhone, stripServiceSuffix } from "./address";

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
