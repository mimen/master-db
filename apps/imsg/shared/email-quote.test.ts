import { describe, expect, test } from "bun:test";

import { splitQuote } from "./email-quote";

describe("splitQuote", () => {
  test("splits at Gmail's attribution line, keeping it with the quote", () => {
    expect(splitQuote("Sounds good.\r\n\r\nOn Sun, Mar 1, 2027 at 10:15 AM Jordan <j@a.test> wrote:\r\n> Hi\r\n> there")).toEqual({
      fresh: "Sounds good.",
      quote: "On Sun, Mar 1, 2027 at 10:15 AM Jordan <j@a.test> wrote:\n> Hi\n> there",
    });
  });

  test("splits at the first > line when no attribution precedes it", () => {
    expect(splitQuote("Yes.\n> Can you?")).toEqual({ fresh: "Yes.", quote: "> Can you?" });
  });

  test("an attribution wrapped over two lines still starts the quote", () => {
    expect(splitQuote("Ok\nOn Mon, Mar 2, 2027, Sam Lee\n<sam@venue.test> wrote:\n> hi")?.fresh).toBe("Ok");
  });

  test("Outlook's header block starts the quote", () => {
    expect(splitQuote("Done.\n\nFrom: Sam Lee\nSent: Monday\nTo: Milad")).toEqual({ fresh: "Done.", quote: "From: Sam Lee\nSent: Monday\nTo: Milad" });
  });

  test("nothing to fold: no quote, or a quote with nothing before it", () => {
    expect(splitQuote("Just a note.")).toBeNull();
    expect(splitQuote("---------- Forwarded message ---------\nFrom: x")).toBeNull();
    expect(splitQuote("\n\n> only quoted")).toBeNull();
  });
});
