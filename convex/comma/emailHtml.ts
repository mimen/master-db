import { defaultTreeAdapter, html as HTML, parse, serialize, type DefaultTreeAdapterMap } from "parse5";

/**
 * Email HTML is hostile input. `cleanEmailHtml` rebuilds it from an allowlist on the server, before any client sees
 * it: no scripts, handlers, forms, frames or <base>, links open in a new tab, tracking pixels go, and remote images
 * are held back as `data-comma-src` until the reader asks for them. The reader also shows the result in a sandboxed
 * iframe under a CSP that blocks remote loads, so either layer alone stops a script. parse5 parses the way browsers
 * do, so what is checked here is what a browser would build.
 */

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

/** Kept, with their allowed attributes. */
const TAGS = new Set([
  "a", "abbr", "address", "article", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col",
  "colgroup", "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small",
  "span", "strike", "strong", "style", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "wbr",
]);
/** Removed with everything inside them. Any other tag is unwrapped: its children stay, the tag goes. */
const DROPPED = new Set([
  "script", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select",
  "option", "textarea", "base", "link", "meta", "title", "svg", "math", "audio", "video", "canvas", "dialog", "portal",
]);
const ATTRIBUTES = new Set([
  "align", "alt", "bgcolor", "border", "cellpadding", "cellspacing", "class", "color", "colspan", "dir", "face", "height", "lang",
  "rowspan", "size", "style", "title", "valign", "width",
]);
const LINK_SCHEMES = /^(https?:|mailto:|tel:)/i;
const DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp);base64,/i;

/** CSS that fetches or runs something. A remote image through CSS would be a tracking pixel too. */
function cleanCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(")
    .replace(/(behavior|-moz-binding)\s*:/gi, "x-blocked:")
    .replace(/javascript:/gi, "");
}

const attr = (element: Element, name: string) => element.attrs.find((candidate) => candidate.name === name)?.value;

/** A 1×1 or hidden image, the shape tracking pixels take. */
function isPixel(element: Element): boolean {
  const tiny = (value: string | undefined) => value !== undefined && /^\s*[0-2](px)?\s*$/.test(value);
  const style = (attr(element, "style") ?? "").toLowerCase().replace(/\s/g, "");
  return tiny(attr(element, "width")) || tiny(attr(element, "height")) ||
    /(^|;)(width|height|max-width|max-height):[0-2](px)?(;|$)/.test(style) || /display:none|visibility:hidden|opacity:0(;|$)/.test(style);
}

type Counts = { blockedImages: number };

/** Rewrites one element's attributes in place; false when the element should go entirely. */
function cleanElement(element: Element, counts: Counts): boolean {
  const kept = element.attrs.filter((candidate) => ATTRIBUTES.has(candidate.name))
    .map((candidate) => candidate.name === "style" ? { ...candidate, value: cleanCss(candidate.value) } : candidate);
  if (element.tagName === "a") {
    const href = attr(element, "href")?.trim();
    if (href && LINK_SCHEMES.test(href)) kept.push({ name: "href", value: href }, { name: "target", value: "_blank" }, { name: "rel", value: "noopener noreferrer" });
  }
  if (element.tagName === "img") {
    const src = attr(element, "src")?.trim() ?? "";
    if (isPixel(element)) return false;
    if (DATA_IMAGE.test(src)) kept.push({ name: "src", value: src });
    else if (/^https?:/i.test(src)) {
      kept.push({ name: "data-comma-src", value: src });
      counts.blockedImages++;
    } else return false;
  }
  element.attrs = kept;
  return true;
}

/** Outlook's reply marker. The quoted mail is every sibling after it, and the cleaner drops the id that finds it. */
const isOutlookReply = (node: Node): node is Element => defaultTreeAdapter.isElementNode(node) && /^(appendonsend|divRplyFwdMsg)$/.test(attr(node, "id") ?? "");
const isElement = (node: Node | undefined, tag: string) => node !== undefined && defaultTreeAdapter.isElementNode(node) && node.tagName === tag;

/** Wraps Outlook's quoted tail, with the rule Outlook draws above it, in `<div class="comma-quote">` for the reader to fold. */
function markOutlookQuote(parent: ParentNode): void {
  if (defaultTreeAdapter.isElementNode(parent) && attr(parent, "class") === "comma-quote") return;
  let start = parent.childNodes.findIndex(isOutlookReply);
  if (start < 0) return;
  if (isElement(parent.childNodes[start - 1], "hr")) start--;
  const quote = defaultTreeAdapter.createElement("div", HTML.NS.HTML, [{ name: "class", value: "comma-quote" }]);
  for (const node of parent.childNodes.slice(start)) {
    defaultTreeAdapter.detachNode(node);
    defaultTreeAdapter.appendChild(quote, node);
  }
  defaultTreeAdapter.appendChild(parent, quote);
}

function cleanChildren(parent: ParentNode, counts: Counts): void {
  markOutlookQuote(parent);
  for (const node of [...parent.childNodes]) {
    if (node.nodeName === "#comment" || node.nodeName === "#documentType") {
      defaultTreeAdapter.detachNode(node);
      continue;
    }
    if (!defaultTreeAdapter.isElementNode(node)) continue;
    const tag = node.tagName;
    if (DROPPED.has(tag)) {
      defaultTreeAdapter.detachNode(node);
      continue;
    }
    if (tag === "style") {
      const css = node.childNodes.map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : "")).join("");
      node.attrs = [];
      node.childNodes = [];
      defaultTreeAdapter.insertText(node, cleanCss(css));
      continue;
    }
    // A <template>'s content and foreign (SVG, MathML) subtrees are dropped above; everything else is HTML.
    cleanChildren(node, counts);
    if (!TAGS.has(tag)) {
      for (const child of [...node.childNodes]) defaultTreeAdapter.insertBefore(parent, child, node);
      defaultTreeAdapter.detachNode(node);
      continue;
    }
    if (!cleanElement(node, counts)) defaultTreeAdapter.detachNode(node);
  }
}

/** The body as a fragment of allowed HTML, its <head> styles first, and how many remote images it holds back. */
export function cleanEmailHtml(html: string): { html: string; blockedImages: number } {
  const document = parse(html);
  const root = document.childNodes.find(defaultTreeAdapter.isElementNode);
  const head = root?.childNodes.find((node): node is Element => defaultTreeAdapter.isElementNode(node) && node.tagName === "head");
  const body = root?.childNodes.find((node): node is Element => defaultTreeAdapter.isElementNode(node) && node.tagName === "body");
  const counts = { blockedImages: 0 };
  const out = defaultTreeAdapter.createDocumentFragment();
  for (const style of head?.childNodes.filter((node): node is Element => defaultTreeAdapter.isElementNode(node) && node.tagName === "style") ?? []) {
    defaultTreeAdapter.appendChild(out, style);
  }
  for (const node of [...(body?.childNodes ?? [])]) defaultTreeAdapter.appendChild(out, node);
  cleanChildren(out, counts);
  return { html: serialize(out), blockedImages: counts.blockedImages };
}

const BLOCKS = new Set([
  "address", "article", "blockquote", "br", "caption", "center", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "ol", "p", "pre", "section", "table", "tr", "ul",
]);
const SKIPPED = new Set([...DROPPED, "style", "head"]);
/** Where mail clients put the quoted thread and the signature, which a model reading the new message does not need. */
function isQuoteOrSignature(element: Element): boolean {
  const classes = ` ${attr(element, "class") ?? ""} `;
  const id = attr(element, "id") ?? "";
  return / gmail_quote | gmail_signature | gmail_attr | yahoo_quoted | moz-cite-prefix /.test(classes) ||
    attr(element, "data-smartmail") === "gmail_signature" || /^(appendonsend|divRplyFwdMsg|Signature)$/.test(id) ||
    (element.tagName === "blockquote" && attr(element, "type") === "cite");
}

/** HTML as plain text, block by block. With `newOnly`, quoted history and signatures are left out. */
export function htmlToText(html: string, { newOnly = false }: { newOnly?: boolean } = {}): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (defaultTreeAdapter.isTextNode(node)) {
      parts.push(node.value.replace(/\s+/g, " "));
      return;
    }
    if (!defaultTreeAdapter.isElementNode(node) && node.nodeName !== "#document") return;
    const element = defaultTreeAdapter.isElementNode(node) ? node : null;
    if (element && (SKIPPED.has(element.tagName) || (newOnly && isQuoteOrSignature(element)))) return;
    const block = element !== null && BLOCKS.has(element.tagName);
    if (block) parts.push("\n");
    for (const child of (node as ParentNode).childNodes) walk(child);
    if (block) parts.push("\n");
  };
  walk(parse(html));
  return parts.join("").split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
