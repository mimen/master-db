import { describe, expect, test } from "bun:test";

import { EMAIL_SANDBOX, emailDocument, inLens } from "./mail";

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
