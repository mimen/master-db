import { describe, expect, test } from "vitest";

import { gmailModelText, isBulk, newContent, parseAddresses, parseGmailMessage, type RawGmailMessage } from "./gmailMessage";

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_");

describe("parseAddresses", () => {
  test("reads names, quoted names with commas, bare addresses, and lowercases", () => {
    expect(parseAddresses(`"Lee, Sam" <Sam@Example.com>, ops@auf.network, Jo Park <jo@x.co>`)).toEqual([
      { address: "sam@example.com", name: "Lee, Sam" }, { address: "ops@auf.network", name: null }, { address: "jo@x.co", name: "Jo Park" },
    ]);
    expect(parseAddresses("undisclosed-recipients:;")).toEqual([]);
  });
});

describe("isBulk", () => {
  const headers = (entries: Record<string, string>) => new Map(Object.entries(entries));
  test("a list header, Precedence, Auto-Submitted, a category label or a machine sender makes mail bulk", () => {
    expect(isBulk(headers({ "list-unsubscribe": "<mailto:u@x>" }), [], "news@x.co")).toBe(true);
    expect(isBulk(headers({ precedence: "bulk" }), [], "sam@x.co")).toBe(true);
    expect(isBulk(headers({ "auto-submitted": "auto-generated" }), [], "sam@x.co")).toBe(true);
    expect(isBulk(headers({}), ["INBOX", "CATEGORY_PROMOTIONS"], "sam@x.co")).toBe(true);
    expect(isBulk(headers({}), [], "no-reply@shotgun.live")).toBe(true);
    expect(isBulk(headers({}), [], "noreply+billing@x.co")).toBe(true);
  });

  test("a person writing is not", () => {
    expect(isBulk(headers({ "auto-submitted": "no" }), ["INBOX", "CATEGORY_PERSONAL"], "sam@x.co")).toBe(false);
    expect(isBulk(headers({}), [], "newsome@x.co")).toBe(false);
  });
});

describe("newContent", () => {
  test("cuts Gmail and Apple quotes, Outlook headers, > lines and signatures", () => {
    expect(newContent("Yes, 8 works.\n\nOn Fri, Nov 6, 2026 at 9:00 AM Milad <m@x.co> wrote:\n> Doors at 8?")).toBe("Yes, 8 works.");
    expect(newContent("Yes.\r\n\r\nOn Fri, Nov 6, 2026 at 9:00 AM Milad\r\n<m@x.co> wrote:\r\n> Doors?")).toBe("Yes.");
    expect(newContent("Sure\n\nFrom: Milad\nSent: Friday\nSubject: x")).toBe("Sure");
    expect(newContent("Sure\n-- \nSam Lee\nAUF")).toBe("Sure");
    expect(newContent("See you\n\nSent from my iPhone")).toBe("See you");
  });
});

describe("parseGmailMessage", () => {
  const raw = (overrides: Partial<RawGmailMessage> & { headers?: Record<string, string> } = {}): RawGmailMessage => ({
    id: "m1", threadId: "t1", internalDate: "1700000000000", labelIds: ["INBOX"], snippet: "Yes, 8 works. On Fri&#39;s",
    payload: {
      mimeType: "multipart/alternative",
      headers: Object.entries({ From: "Sam Lee <sam@x.co>", To: "milad@afternoonumbrellafriends.com", Subject: "Doors", ...overrides.headers })
        .map(([name, value]) => ({ name, value })),
      parts: [
        { mimeType: "text/plain", body: { data: b64("Yes, 8 works.\n\nOn Fri, Nov 6, 2026 Milad wrote:\n> Doors at 8? 🎉") } },
        { mimeType: "text/html", body: { data: b64('<div>Yes, 8 works.<img src="https://t.co/p.gif" width="1"></div><div class="gmail_quote">Doors at 8?</div><script>x()</script>') } },
      ],
    },
    ...overrides,
  });

  test("a person's reply keeps its plain text, cleaned HTML, subject and thread, and the model reads only the new part", () => {
    const message = parseGmailMessage(raw());
    expect(message).toMatchObject({
      id: "m1", threadId: "t1", internalDate: 1_700_000_000_000, from: { address: "sam@x.co", name: "Sam Lee" },
      to: [{ address: "milad@afternoonumbrellafriends.com", name: null }], subject: "Doors", bulk: false, snippet: "Yes, 8 works. On Fri's",
      model: { modelText: "Yes, 8 works.", subject: "Doors", threadRef: "t1" },
    });
    expect(message.text).toContain("Doors at 8? 🎉");
    expect(message.html).not.toMatch(/script|t\.co/);
  });

  test("bulk mail is read as headers: the snippet stands in for the body and no HTML is kept", () => {
    const message = parseGmailMessage(raw({ headers: { "List-Unsubscribe": "<https://x.co/u>" } }));
    expect(message).toMatchObject({ bulk: true, text: "Yes, 8 works. On Fri's" });
    expect(message.html).toBeUndefined();
  });

  test("gmailModelText falls back to the plain text, and names the thread", () => {
    expect(gmailModelText({ text: "Plain only", subject: "", threadId: "t9" })).toEqual({ threadRef: "t9" });
  });
});
