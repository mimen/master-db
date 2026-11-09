import type { GenericId } from "convex/values";
import { describe, expect, test } from "bun:test";

import { EMAIL_SANDBOX, emailDocument, messageFiles, openByDefault, threadFiles } from "./mail";
import { regularSenders } from "./mail-lens";
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

const id = (value: string) => value as GenericId<"_storage">;

describe("files a reply all or forward carries", () => {
  const pdf = { filename: "invoice.pdf", mimeType: "application/pdf", totalBytes: 900, originalStorageId: id("s1"), gmail: { inline: false } };
  const logo = { filename: "logo.png", mimeType: "image/png", totalBytes: 40, originalStorageId: id("s2"), gmail: { inline: true } };
  const pending = { filename: "big.zip", mimeType: "application/zip", totalBytes: 9e7 };

  test("a message's stored files, without the images its body shows inline or a file never stored", () => {
    expect(messageFiles({ attachments: [pdf, logo, pending] })).toEqual([{ storageId: id("s1"), filename: "invoice.pdf", mimeType: "application/pdf", size: 900 }]);
  });

  test("a thread's files, oldest first, the same file sent again counted once", () => {
    const sheet = { ...pdf, filename: "sheet.xlsx", originalStorageId: id("s3") };
    expect(threadFiles([{ attachments: [pdf] }, { attachments: [{ ...pdf, originalStorageId: id("s4") }, sheet] }]).map((file) => String(file.storageId))).toEqual(["s1", "s3"]);
  });
});

describe("inline images", () => {
  const html = '<p>Hi</p><img alt="Logo" data-comma-cid="logo@venue"><img data-comma-cid="other">';

  test("a cid image draws from its data: URL, an unknown one or a URL that is not an image stays without a src", () => {
    const doc = emailDocument(html, { images: false, inline: { "logo@venue": "data:image/png;base64,iVBORw0KGgo=", other: "javascript:alert(1)" } });
    expect(doc).toContain('<img alt="Logo" src="data:image/png;base64,iVBORw0KGgo=">');
    expect(doc).toContain('<img data-comma-cid="other">');
    expect(doc).toContain(`img-src data:">`);
  });
});
