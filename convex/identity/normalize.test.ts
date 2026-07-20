import { describe, expect, test } from "vitest";

import { deriveNormalized, kindForNetwork, normalizeEmail, normalizePhone } from "./normalize";

describe("normalizeEmail", () => {
  test("lowercases and trims", () => {
    expect(normalizeEmail("  Milad@Example.com  ")).toBe("milad@example.com");
  });

  test("rejects strings without a plausible email shape", () => {
    expect(normalizeEmail("not-an-email")).toBe("");
    expect(normalizeEmail("@missing-local.com")).toBe("");
    expect(normalizeEmail("missing-domain@")).toBe("");
  });
});

describe("normalizePhone", () => {
  test("bare 10-digit number gets US +1 default", () => {
    expect(normalizePhone("6195551234")).toBe("+16195551234");
  });

  test("11-digit number leading 1 gets a plus", () => {
    expect(normalizePhone("16195551234")).toBe("+16195551234");
  });

  test("already-plussed international number passes through digits-only", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  test("strips punctuation before counting digits", () => {
    expect(normalizePhone("(619) 555-1234")).toBe("+16195551234");
  });

  test("pulls a phone out of a WhatsApp-style JID", () => {
    expect(normalizePhone("+16195551234@s.whatsapp.net")).toBe("+16195551234");
  });

  test("too few digits returns empty", () => {
    expect(normalizePhone("12345")).toBe("");
  });

  test("empty input returns empty", () => {
    expect(normalizePhone("")).toBe("");
  });
});

describe("kindForNetwork", () => {
  test("maps known Beeper networks case-insensitively", () => {
    expect(kindForNetwork("WhatsApp")).toBe("whatsapp");
    expect(kindForNetwork("Google Messages")).toBe("gmessages");
    expect(kindForNetwork("gmessages")).toBe("gmessages");
    expect(kindForNetwork("iMessage")).toBe("imessage");
    expect(kindForNetwork("Telegram")).toBe("telegram");
    expect(kindForNetwork("Slack")).toBe("slack");
    expect(kindForNetwork("slackgo")).toBe("slack");
    expect(kindForNetwork("Signal")).toBe("signal");
    expect(kindForNetwork("Matrix")).toBe("matrix");
  });

  test("unknown or missing network falls back to other", () => {
    expect(kindForNetwork("carrier-pigeon")).toBe("other");
    expect(kindForNetwork(undefined)).toBe("other");
  });
});

describe("deriveNormalized", () => {
  test("prefers the separate phone_number field when present", () => {
    expect(deriveNormalized("@user:beeper.local", "6195551234")).toEqual({
      normalized: "+16195551234",
      via: "phone",
    });
  });

  test("falls back to extracting a phone from the raw value", () => {
    expect(deriveNormalized("+16195551234@s.whatsapp.net", undefined)).toEqual({
      normalized: "+16195551234",
      via: "phone",
    });
  });

  test("falls back to email when no phone is derivable", () => {
    expect(deriveNormalized("milad@example.com", undefined)).toEqual({
      normalized: "milad@example.com",
      via: "email",
    });
  });

  test("returns empty/none when neither phone nor email can be derived", () => {
    expect(deriveNormalized("@bot:matrix.org", undefined)).toEqual({
      normalized: "",
      via: "none",
    });
  });
});
