import { describe, expect, test } from "bun:test";

import { EMAIL_SANDBOX, emailDocument, formatAddress, hasRecipient, openByDefault, regularSenders, replyFields } from "./mail";
import { inLens } from "./mail-lens";

describe("inLens", () => {
  const row = (known: boolean, bulk: boolean, unresponded: boolean) => ({ known, gmail: { bulk }, flags: { unresponded } });

  test("People holds a known sender owed a reply; bulk mail, strangers and answered threads stay in All inbox", () => {
    expect(inLens(row(true, false, true), "people")).toBe(true);
    expect(inLens(row(true, true, true), "people")).toBe(false);
    expect(inLens(row(false, false, true), "people")).toBe(false);
    expect(inLens(row(true, false, false), "people")).toBe(false);
    for (const candidate of [row(true, true, true), row(false, false, false)]) expect(inLens(candidate, "all")).toBe(true);
  });
});

describe("regularSenders", () => {
  test("a sender on three threads is regular, whatever the case of the address; one on two is not", () => {
    const thread = (...addresses: string[]) => ({ participants: addresses.map((address) => ({ address })) });
    expect(regularSenders([thread("news@club.test"), thread("News@Club.test", "news@club.test"), thread("news@club.test"), thread("pat@a.test"), thread("pat@a.test")]))
      .toEqual(new Set(["news@club.test"]));
  });
});

describe("openByDefault", () => {
  const thread = [
    { _id: "a", isFromMe: false }, { _id: "b", isFromMe: true }, { _id: "c", isFromMe: false }, { _id: "d", isFromMe: false }, { _id: "e", isFromMe: true },
  ];

  test("with nothing unread, only the newest opens, and the reader lands on it", () => {
    expect(openByDefault(thread, 0)).toEqual({ open: new Set(["e"]), target: "e" });
  });

  test("the newest unread received messages open beside the newest, and the reader lands on the first of them", () => {
    expect(openByDefault(thread, 2)).toEqual({ open: new Set(["c", "d", "e"]), target: "c" });
  });

  test("an empty thread opens nothing", () => {
    expect(openByDefault([], 3)).toEqual({ open: new Set(), target: undefined });
  });
});

describe("emailDocument", () => {
  const html = '<p>Hi</p><img alt="Venue" data-comma-src="https://cdn.test/photo.jpg">';

  test("blocks every remote load by CSP and keeps remote images unloaded until asked", () => {
    const doc = emailDocument(html, { images: false });
    expect(doc).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"`);
    expect(doc).not.toMatch(/ src="https:/);
  });

  test("Load images lets images, and only images, load", () => {
    const doc = emailDocument(html, { images: true });
    expect(doc).toContain("img-src data: https: http:");
    expect(doc).toContain('<img alt="Venue" src="https://cdn.test/photo.jpg">');
    expect(doc).toContain("default-src 'none'");
  });

  test("the sandbox never allows scripts", () => {
    expect(EMAIL_SANDBOX).not.toContain("allow-scripts");
  });
});

describe("replyFields", () => {
  const me = { address: "milad@auf.test", name: "Milad" };
  const sam = { address: "sam@venue.test", name: "Sam Lee" };
  const pat = { address: "pat@agency.test", name: null };
  const dana = { address: "dana@venue.test", name: "Ortiz, Dana" };
  const self = new Set(["milad@auf.test"]);
  const inbound = { isFromMe: false, from: sam, to: [me, dana], cc: [pat] };

  test("reply answers the sender; reply all adds everyone else on the message, never the user", () => {
    expect(replyFields(inbound, "reply", "Doors", self)).toEqual({ to: "Sam Lee <sam@venue.test>", cc: "", subject: "Re: Doors" });
    expect(replyFields(inbound, "replyAll", "Doors", self)).toEqual({
      to: 'Sam Lee <sam@venue.test>, "Ortiz, Dana" <dana@venue.test>', cc: "pat@agency.test", subject: "Re: Doors",
    });
  });

  test("on the user's own message, reply goes back to its recipients, and a subject that is already a reply keeps its prefix", () => {
    const outbound = { isFromMe: true, from: me, to: [sam], cc: [pat, me] };
    expect(replyFields(outbound, "reply", "RE: Doors", self)).toEqual({ to: "Sam Lee <sam@venue.test>", cc: "", subject: "RE: Doors" });
    expect(replyFields(outbound, "replyAll", "Doors", self)).toEqual({ to: "Sam Lee <sam@venue.test>", cc: "pat@agency.test", subject: "Re: Doors" });
  });

  test("an address and a quoted name format as typed, and a field needs an address to send", () => {
    expect(formatAddress(dana)).toBe('"Ortiz, Dana" <dana@venue.test>');
    expect(formatAddress(pat)).toBe("pat@agency.test");
    expect(hasRecipient({ to: "Sam", cc: "" })).toBe(false);
    expect(hasRecipient({ to: "", cc: "pat@agency.test" })).toBe(true);
  });
});
