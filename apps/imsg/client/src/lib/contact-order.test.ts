import { describe, expect, test } from "bun:test";
import {
  contactSectionLetter,
  contactTitle,
  lastFirstLabel,
  orderContacts,
  type NamedContact,
} from "./contact-order";

function person(display_name: string, first_name?: string, last_name?: string): NamedContact {
  return { display_name, first_name, last_name };
}

describe("lastFirstLabel", () => {
  test("both parts present renders 'Last, First'", () => {
    expect(lastFirstLabel(person("Alex Chen", "Alex", "Chen"))).toBe("Chen, Alex");
  });

  test("missing first_name falls back to just the last name — no leading comma", () => {
    expect(lastFirstLabel(person("Rivera", undefined, "Rivera"))).toBe("Rivera");
  });

  test("missing last_name falls back to just the first name — no trailing comma", () => {
    expect(lastFirstLabel(person("Jamie", "Jamie", undefined))).toBe("Jamie");
  });

  test("neither structured part present falls back to display_name", () => {
    expect(lastFirstLabel(person("The Brooklyn Mirage"))).toBe("The Brooklyn Mirage");
  });
});

describe("contactTitle", () => {
  test("first-last mode always renders display_name unchanged, even with structured parts", () => {
    expect(contactTitle(person("Alex Chen", "Alex", "Chen"), "first-last")).toBe("Alex Chen");
  });

  test("last-first mode renders the Last, First label", () => {
    expect(contactTitle(person("Alex Chen", "Alex", "Chen"), "last-first")).toBe("Chen, Alex");
  });

  test("last-first mode falls back to display_name when no structured name exists", () => {
    expect(contactTitle(person("@nataliekowal_"), "last-first")).toBe("@nataliekowal_");
  });
});

describe("contactSectionLetter", () => {
  test("first-last mode keys off display_name's initial", () => {
    expect(contactSectionLetter(person("Zoe Adams", "Zoe", "Adams"), "first-last")).toBe("Z");
  });

  test("last-first mode keys off the last-name initial", () => {
    expect(contactSectionLetter(person("Zoe Adams", "Zoe", "Adams"), "last-first")).toBe("A");
  });

  test("last-first mode falls back to display_name's initial when last_name is missing", () => {
    expect(contactSectionLetter(person("Zoe", "Zoe"), "last-first")).toBe("Z");
  });

  test("a non-alphabetic leading character buckets under '#' in either mode", () => {
    expect(contactSectionLetter(person("123 Pizza"), "first-last")).toBe("#");
    expect(contactSectionLetter(person("123 Pizza"), "last-first")).toBe("#");
  });
});

describe("orderContacts", () => {
  const people = [
    person("Bea Young", "Bea", "Young"),
    person("Alex Chen", "Alex", "Chen"),
    person("Sam Adams", "Sam", "Adams"),
  ];

  test("first-last mode passes the input order through unchanged", () => {
    const rows = orderContacts(people, "first-last");
    expect(rows.map((r) => r.person.display_name)).toEqual(["Bea Young", "Alex Chen", "Sam Adams"]);
    expect(rows.map((r) => r.title)).toEqual(["Bea Young", "Alex Chen", "Sam Adams"]);
  });

  test("last-first mode sorts by (last_name, first_name)", () => {
    const rows = orderContacts(people, "last-first");
    expect(rows.map((r) => r.person.display_name)).toEqual(["Sam Adams", "Alex Chen", "Bea Young"]);
    expect(rows.map((r) => r.title)).toEqual(["Adams, Sam", "Chen, Alex", "Young, Bea"]);
  });

  test("last-first mode breaks ties on same last name by first name", () => {
    const tied = [person("Bo Adams", "Bo", "Adams"), person("Al Adams", "Al", "Adams")];
    const rows = orderContacts(tied, "last-first");
    expect(rows.map((r) => r.person.display_name)).toEqual(["Al Adams", "Bo Adams"]);
  });

  test("a person missing structured names sorts and renders by display_name in last-first mode", () => {
    const mixed = [
      person("Zed Org"),
      person("Amy Baker", "Amy", "Baker"),
    ];
    const rows = orderContacts(mixed, "last-first");
    // "Amy Baker" sorts under "Baker"; "Zed Org" has no last_name so it falls
    // back to its display_name for both the sort key and the section letter.
    expect(rows.map((r) => r.person.display_name)).toEqual(["Amy Baker", "Zed Org"]);
    expect(rows.map((r) => r.title)).toEqual(["Baker, Amy", "Zed Org"]);
    expect(rows.map((r) => r.sectionLetter)).toEqual(["B", "Z"]);
  });
});
