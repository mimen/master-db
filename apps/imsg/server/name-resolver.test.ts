import { describe, expect, test } from "bun:test";
import type { ContactBook } from "./contacts";
import type { IdentityMirror } from "./identity-mirror";
import { NameResolver, type CrmData } from "./name-resolver";

function fakeMirror(
  map: Record<string, string>,
  terms: Record<string, string[]> = {},
  crm: Record<string, CrmData> = {},
  chatCrm: Record<string, CrmData> = {},
): Pick<IdentityMirror, "lookup" | "searchTerms" | "personCrm" | "chatCrm"> {
  return {
    lookup: (address: string) => map[address] ?? null,
    searchTerms: (address: string) => terms[address] ?? [],
    personCrm: (address: string) => crm[address],
    chatCrm: (chatGuid: string) => chatCrm[chatGuid],
  };
}

function fakeContactBook(map: Record<string, string>, available = true): ContactBook {
  return {
    lookup: (address: string) => map[address] ?? null,
    searchTerms: (address: string) => (map[address] ? [map[address]] : []),
    chatCrm: () => undefined,
    personCrm: () => undefined,
    available,
  } as ContactBook;
}

describe("NameResolver", () => {
  test("mirror name wins over ContactBook when both have an entry", () => {
    const mirror = fakeMirror({ "+15550001111": "Mirror Name" }) as IdentityMirror;
    const contacts = fakeContactBook({ "+15550001111": "Stale Apple Name" });
    const resolver = new NameResolver(mirror, contacts);
    expect(resolver.lookup("+15550001111")).toBe("Mirror Name");
  });

  test("ContactBook fills a mirror miss", () => {
    const mirror = fakeMirror({}) as IdentityMirror;
    const contacts = fakeContactBook({ "+15550001111": "Apple Only" });
    const resolver = new NameResolver(mirror, contacts);
    expect(resolver.lookup("+15550001111")).toBe("Apple Only");
  });

  test("both miss resolves to unknown (null)", () => {
    const mirror = fakeMirror({}) as IdentityMirror;
    const contacts = fakeContactBook({});
    const resolver = new NameResolver(mirror, contacts);
    expect(resolver.lookup("+15550001111")).toBeNull();
  });

  test("available mirrors ContactBook.available only — an available mirror doesn't affect it", () => {
    const mirror = fakeMirror({ "+15550001111": "Mirror Name" }) as IdentityMirror;
    const contacts = fakeContactBook({}, false);
    const resolver = new NameResolver(mirror, contacts);
    // ContactBook unavailable: contactsAvailable-derived flag must stay false
    // even though the mirror itself has a hit — fail-open semantics live at
    // the mapChat layer via this exact getter, not by inferring from lookup.
    expect(resolver.available).toBe(false);
    expect(resolver.lookup("+15550001111")).toBe("Mirror Name");
  });

  test("available is true when ContactBook is available, regardless of mirror state", () => {
    const mirror = fakeMirror({}) as IdentityMirror;
    const contacts = fakeContactBook({}, true);
    const resolver = new NameResolver(mirror, contacts);
    expect(resolver.available).toBe(true);
  });

  describe("searchTerms", () => {
    test("returns the mirror's full term list when it has a hit", () => {
      const mirror = fakeMirror(
        {},
        { "+15550001111": ["uncle jimmy", "jimmy", "sciandra", "jimmy sciandra"] },
      ) as IdentityMirror;
      const contacts = fakeContactBook({ "+15550001111": "Stale Apple Name" });
      const resolver = new NameResolver(mirror, contacts);
      expect(resolver.searchTerms("+15550001111")).toEqual([
        "uncle jimmy",
        "jimmy",
        "sciandra",
        "jimmy sciandra",
      ]);
    });

    test("falls back to ContactBook's single name when the mirror misses", () => {
      const mirror = fakeMirror({}) as IdentityMirror;
      const contacts = fakeContactBook({ "+15550001111": "Apple Only" });
      const resolver = new NameResolver(mirror, contacts);
      expect(resolver.searchTerms("+15550001111")).toEqual(["Apple Only"]);
    });

    test("both miss resolves to []", () => {
      const mirror = fakeMirror({}) as IdentityMirror;
      const contacts = fakeContactBook({});
      const resolver = new NameResolver(mirror, contacts);
      expect(resolver.searchTerms("+15550001111")).toEqual([]);
    });
  });

  describe("chatCrm / personCrm", () => {
    test("chatCrm reads straight from the mirror — no ContactBook fallback", () => {
      const mirror = fakeMirror({}, {}, {}, { g1: { is_favorite: true, tags: ["planning"] } }) as IdentityMirror;
      const contacts = fakeContactBook({});
      const resolver = new NameResolver(mirror, contacts);
      expect(resolver.chatCrm("g1")).toEqual({ is_favorite: true, tags: ["planning"] });
      expect(resolver.chatCrm("g2")).toBeUndefined();
    });

    test("personCrm reads straight from the mirror — no ContactBook fallback (Apple has no CRM concept)", () => {
      const mirror = fakeMirror({}, {}, { "+15550001111": { priority: 1, tags: ["vip"] } }) as IdentityMirror;
      const contacts = fakeContactBook({ "+15550001111": "Apple Name" });
      const resolver = new NameResolver(mirror, contacts);
      expect(resolver.personCrm("+15550001111")).toEqual({ priority: 1, tags: ["vip"] });
    });

    test("personCrm is undefined when the mirror has no CRM for the address, even if ContactBook knows the name", () => {
      const mirror = fakeMirror({}) as IdentityMirror;
      const contacts = fakeContactBook({ "+15550001111": "Apple Only" });
      const resolver = new NameResolver(mirror, contacts);
      expect(resolver.personCrm("+15550001111")).toBeUndefined();
    });
  });
});
