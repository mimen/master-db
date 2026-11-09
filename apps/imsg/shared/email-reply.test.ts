import { describe, expect, test } from "bun:test";

import { forwardSubject, forwardText, mailboxText, parseTyped, replyRecipients, replySubject } from "./email-reply";

const me = { address: "milad@auf.test", name: "Milad" };
const sam = { address: "sam@venue.test", name: "Sam Lee" };
const pat = { address: "pat@agency.test", name: null };
const dana = { address: "dana@venue.test", name: "Ortiz, Dana" };
const self = new Set(["milad@auf.test", "milad@alias.test"]);

describe("replyRecipients", () => {
  const inbound = { isFromMe: false, from: sam, to: [me, dana], cc: [pat, { address: "Milad@Alias.test", name: null }, sam] };

  test("reply answers the sender; reply all is the sender plus To, Cc the message's Cc, never the user, each once", () => {
    expect(replyRecipients(inbound, "reply", self)).toEqual({ to: [sam], cc: [] });
    expect(replyRecipients(inbound, "replyAll", self)).toEqual({ to: [sam, dana], cc: [pat] });
  });

  test("on the user's own message, reply goes back to its recipients", () => {
    const outbound = { isFromMe: true, from: me, to: [sam], cc: [pat, me] };
    expect(replyRecipients(outbound, "reply", self)).toEqual({ to: [sam], cc: [] });
    expect(replyRecipients(outbound, "replyAll", self)).toEqual({ to: [sam], cc: [pat] });
  });
});

describe("subjects, addresses and forwards", () => {
  test("a subject that is already a reply or forward keeps its prefix", () => {
    expect([replySubject("Doors"), replySubject("RE: Doors"), forwardSubject("Re: Doors"), forwardSubject("FW: Doors")])
      .toEqual(["Re: Doors", "RE: Doors", "Fwd: Re: Doors", "FW: Doors"]);
  });

  test("an address writes as typed, a name with a separator quoted, and typed text reads back", () => {
    expect(mailboxText(dana)).toBe('"Ortiz, Dana" <dana@venue.test>');
    expect(mailboxText(pat)).toBe("pat@agency.test");
    expect(parseTyped('Sam Lee <Sam@Venue.test>; pat@agency.test, not an address')).toEqual([sam, pat]);
  });

  test("a forward puts the note above Gmail's forwarded block with the original's headers and text", () => {
    const original = { isFromMe: false, from: sam, to: [me], cc: [pat], date: Date.UTC(2026, 10, 6, 18, 5), subject: "Invoice #42", text: "Attached." };
    // ICU builds join the date and time with "at" or a comma.
    expect(forwardText("Carlos, for the books.", original, "UTC").replace(/2026(,| at) /, "2026 at ")).toBe([
      "Carlos, for the books.", "", "---------- Forwarded message ---------", "From: Sam Lee <sam@venue.test>",
      "Date: Fri, Nov 6, 2026 at 6:05 PM", "Subject: Invoice #42", "To: Milad <milad@auf.test>", "Cc: pat@agency.test", "", "Attached.",
    ].join("\n"));
    expect(forwardText("  ", original, "UTC")).toStartWith("---------- Forwarded message ---------");
  });
});
