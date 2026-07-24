import { describe, expect, test } from "bun:test";
import type { BBContact } from "./bb-types";
import { toContactCard } from "./identity-sync";

describe("toContactCard", () => {
  test("prefers displayName, then nickname, then assembled first+last", () => {
    const c: BBContact = { displayName: "Chase P.", firstName: "Chase", lastName: "Petersen" };
    expect(toContactCard(c).display_name).toBe("Chase P.");
  });

  test("falls back to nickname when displayName is missing", () => {
    const c: BBContact = { nickname: "Chasey", firstName: "Chase" };
    expect(toContactCard(c).display_name).toBe("Chasey");
  });

  test("falls back to assembled first+last when neither displayName nor nickname is set", () => {
    const c: BBContact = { firstName: "Chase", lastName: "Petersen" };
    expect(toContactCard(c).display_name).toBe("Chase Petersen");
  });

  test("display_name is undefined when the card has no name fields at all", () => {
    const c: BBContact = {};
    expect(toContactCard(c).display_name).toBeUndefined();
  });

  test("collects all phone and email addresses, dropping empty ones", () => {
    const c: BBContact = {
      phoneNumbers: [{ address: "6195551234" }, { address: "" }, { address: "8585559876" }],
      emails: [{ address: "chase@example.com" }],
    };
    const card = toContactCard(c);
    expect(card.phones).toEqual(["6195551234", "8585559876"]);
    expect(card.emails).toEqual(["chase@example.com"]);
  });

  test("a card with no phones or emails produces empty arrays, not undefined", () => {
    const c: BBContact = { displayName: "No Handles" };
    const card = toContactCard(c);
    expect(card.phones).toEqual([]);
    expect(card.emails).toEqual([]);
  });

  test("never includes avatar bytes — a photo alone can exceed Convex's 1MiB doc cap", () => {
    const c: BBContact = { displayName: "Has Photo", avatar: "  base64data  " };
    expect(toContactCard(c)).not.toHaveProperty("img_url");
  });

  test("passes through first_name/last_name/nickname/source_contact_id alongside the assembled display_name", () => {
    const c: BBContact = {
      id: "UUID-ABC:ABPerson",
      displayName: "Chase P.",
      firstName: "Chase",
      lastName: "Petersen",
      nickname: "Chasey",
    };
    const card = toContactCard(c);
    expect(card.display_name).toBe("Chase P.");
    expect(card.first_name).toBe("Chase");
    expect(card.last_name).toBe("Petersen");
    expect(card.nickname).toBe("Chasey");
    expect(card.source_contact_id).toBe("UUID-ABC:ABPerson");
  });

  test("first_name/last_name/nickname/source_contact_id are undefined, not empty strings, when absent", () => {
    const c: BBContact = { displayName: "No Structure" };
    const card = toContactCard(c);
    expect(card.first_name).toBeUndefined();
    expect(card.last_name).toBeUndefined();
    expect(card.nickname).toBeUndefined();
    expect(card.source_contact_id).toBeUndefined();
  });
});
