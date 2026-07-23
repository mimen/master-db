import { describe, expect, test } from "bun:test";
import type { ContactBook } from "./contacts";
import type { IdentityMirror } from "./identity-mirror";
import { NameResolver } from "./name-resolver";

function fakeMirror(map: Record<string, string>): Pick<IdentityMirror, "lookup"> {
  return { lookup: (address: string) => map[address] ?? null };
}

function fakeContactBook(map: Record<string, string>, available = true): ContactBook {
  return {
    lookup: (address: string) => map[address] ?? null,
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
});
