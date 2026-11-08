import { describe, expect, test } from "vitest";

import { cleanEmailHtml, htmlToText } from "./emailHtml";

const HOSTILE = `<!doctype html><html><head><title>t</title><meta http-equiv="refresh" content="0;url=https://evil.test">
<base href="https://evil.test/"><style>@import url(https://evil.test/a.css); .x { background: url(https://track.test/bg.png); color: red }</style>
<script>alert(1)</script></head><body onload="alert(2)">
<p class="x" onclick="alert(3)" style="color: blue; background-image: url('https://track.test/inline.png')">Hello <b>Milad</b></p>
<img src="https://track.test/open.gif?u=milad" width="1" height="1" alt="">
<img src="https://track.test/pixel.png" style="display:none">
<img src="https://cdn.test/photo.jpg" width="600" alt="Venue">
<img src="data:image/png;base64,iVBORw0KGgo=" alt="inline">
<img src="cid:logo@x" alt="logo">
<a href="javascript:alert(4)">bad link</a> <a href="https://auf.network/tix">tickets</a> <a href="mailto:a@b.co">mail</a>
<iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name="pw"><button>Go</button></form>
<svg><script>alert(5)</script></svg><math><mi xlink:href="javascript:alert(6)">x</mi></math>
<object data="x.swf"></object><custom-tag>kept text</custom-tag><!-- a comment -->
</body></html>`;

describe("cleanEmailHtml", () => {
  const { html, blockedImages } = cleanEmailHtml(HOSTILE);

  test("a message with a script and a tracking pixel comes out with neither", () => {
    expect(html).not.toMatch(/<script|alert\(/i);
    expect(html).not.toContain("track.test/open.gif");
    expect(html).not.toContain("track.test/pixel.png");
    expect(html).toContain("Hello <b>Milad</b>");
  });

  test("handlers, javascript: links, frames, forms, base, meta, foreign content and comments go", () => {
    expect(html).not.toMatch(/onload|onclick|javascript:|<iframe|<form|<input|<button|<base|<meta|<svg|<math|<object|<title|<!--/i);
  });

  test("remote images wait behind data-comma-src; inline data images stay; cid images go", () => {
    expect(blockedImages).toBe(1);
    expect(html).toContain('<img width="600" alt="Venue" data-comma-src="https://cdn.test/photo.jpg">');
    expect(html).not.toMatch(/ src="https:/);
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).not.toContain("cid:");
  });

  test("CSS keeps its look but loses every remote fetch", () => {
    expect(html).toContain("color: red");
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).toContain('style="color: blue; background-image: none"');
  });

  test("links open in a new tab without an opener; unknown tags unwrap", () => {
    expect(html).toContain('<a href="https://auf.network/tix" target="_blank" rel="noopener noreferrer">tickets</a>');
    expect(html).toContain('<a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">mail</a>');
    expect(html).toContain("<a>bad link</a>");
    expect(html).toContain("kept text");
    expect(html).not.toContain("custom-tag");
  });

  test("text that looks like markup stays text", () => {
    expect(cleanEmailHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>").html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});

describe("htmlToText", () => {
  const reply = `<div dir="ltr">Sounds good, see you at 8.<div><br></div><div class="gmail_signature" data-smartmail="gmail_signature">Sam<br>AUF</div></div>
<br><div class="gmail_quote"><div class="gmail_attr">On Fri, Nov 6, 2026 at 9:00 AM Milad wrote:<br></div><blockquote class="gmail_quote">Doors at 8?</blockquote></div>`;

  test("blocks become lines, and scripts and styles are not text", () => {
    expect(htmlToText("<style>p{}</style><p>One</p><p>Two <b>three</b></p><script>x()</script>")).toBe("One\n\nTwo three");
  });

  test("newOnly leaves out Gmail's quote and signature", () => {
    expect(htmlToText(reply, { newOnly: true })).toBe("Sounds good, see you at 8.");
    expect(htmlToText(reply)).toContain("Doors at 8?");
  });
});
