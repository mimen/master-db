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
});
