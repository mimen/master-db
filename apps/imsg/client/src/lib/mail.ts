import type { GenericId } from "convex/values";

import { Colors } from "@/constants/tokens";

/**
 * The Mail workspace's pure rules for the document an email's cleaned HTML renders in, and for the files a reply all
 * or forward carries; who a reply goes to is shared/email-reply.ts. Convex cleans the HTML (convex/comma/emailHtml.ts);
 * the reader shows it in an iframe with no scripts, under a CSP that blocks every remote load until the user asks for
 * images, so either layer alone keeps a script out. The lenses are in mail-lens.ts.
 */

/** HTML that paints its own backgrounds, so recolouring its text for dark mode could leave it unreadable. */
const DESIGNED = /\bbgcolor\s*=|background(-color|-image)?\s*:/i;

const DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * The iframe's whole document. `images`: the user asked for this message's remote images. `inline`: data: URLs for
 * the message's own `cid:` images by Content-ID, which load under the CSP as any data: image does.
 */
export function emailDocument(html: string, { images, inline = {} }: { images: boolean; inline?: Readonly<Record<string, string>> }): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${images ? " https: http:" : ""}`;
  const remote = images ? html.replace(/ data-comma-src="/g, ' src="') : html;
  const body = remote.replace(/ data-comma-cid="([^"]*)"/g, (attribute, cid: string) => {
    const url = inline[cid.replace(/&amp;/g, "&")];
    return url && DATA_IMAGE.test(url) ? ` src="${url}"` : attribute;
  });
  // A plain email takes the app's dark surface; a designed one (its own backgrounds) keeps the white card it was drawn on.
  const dark = DESIGNED.test(body) ? ""
    : `@media (prefers-color-scheme:dark){:root{color-scheme:dark}html,body{background:${Colors.dark.surface};color:${Colors.dark.text}}` +
      `a{color:${Colors.dark.accent}}details.comma-fold>summary{background:${Colors.dark.backgroundElement};color:${Colors.dark.textSecondary}}}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
    "<style>html,body{margin:0;background:#fff;color:#1d1d1f;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
    "overflow-wrap:anywhere}body{display:flow-root;padding:12px 14px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}" +
    "details.comma-fold>summary{display:inline-block;list-style:none;cursor:pointer;margin:4px 0;padding:0 7px;border-radius:7px;" +
    "background:#e8eaed;color:#5f6368;font-size:12px;line-height:14px;letter-spacing:1px}details.comma-fold>summary:hover{background:#dadce0}" +
    `details.comma-fold>summary::-webkit-details-marker{display:none}details.comma-fold[open]>summary{margin-bottom:8px}${dark}</style></head>` +
    `<body>${body}</body></html>`;
}

/** The sandbox the iframe runs in: same origin so the reader can size it, popups for links, and never scripts. */
export const EMAIL_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/**
 * Quoted history in cleaned HTML. `comma-quote` is Outlook's tail, which only ingest can find (emailHtml.ts); Gmail and
 * Yahoo mark theirs by class; Apple Mail's `<blockquote type="cite">` reaches the reader as a plain blockquote.
 */
const QUOTE_SELECTOR = ".comma-quote, .gmail_quote, .yahoo_quoted, blockquote";
const ATTRIBUTION = /^On\b[\s\S]{1,300}wrote:$/;

/**
 * Folds each outermost quote in the email's document behind a "•••" toggle, as Gmail does, with the "On … wrote:" line
 * just before it. A forward, or a message that is nothing but quote, stays open. Runs in the reader on the sandboxed
 * iframe's document, which holds no scripts; `<details>` toggles without one.
 */
export function foldQuotes(doc: Document): number {
  const quotes = [...doc.querySelectorAll(QUOTE_SELECTOR)]
    .filter((quote) => !quote.parentElement?.closest(QUOTE_SELECTOR) && !/^\s*-+\s*Forwarded message/i.test(quote.textContent ?? ""));
  const outside = quotes.reduce((text, quote) => text.replace(quote.textContent ?? "", ""), doc.body.textContent ?? "");
  if (!outside.trim()) return 0;
  for (const quote of quotes) {
    let attribution = quote.previousSibling;
    while (attribution && (attribution.nodeName === "BR" || (attribution.nodeType === 3 && !attribution.textContent?.trim()))) attribution = attribution.previousSibling;
    const fold = doc.createElement("details");
    fold.className = "comma-fold";
    const toggle = doc.createElement("summary");
    toggle.title = "Show quoted text";
    toggle.setAttribute("aria-label", "Show quoted text");
    toggle.textContent = "•••";
    quote.before(fold);
    fold.append(toggle);
    if (attribution && ATTRIBUTION.test(attribution.textContent?.trim() ?? "")) fold.append(attribution);
    fold.append(quote);
  }
  return quotes.length;
}

/** How many inbox threads make a sender one the user gets regularly. */
const REGULAR_THREADS = 3;

/** Senders on at least REGULAR_THREADS of these threads, lowercased. */
export function regularSenders(threads: readonly { participants: readonly { address: string }[] }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    for (const address of new Set(thread.participants.map((participant) => participant.address.toLowerCase()))) counts.set(address, (counts.get(address) ?? 0) + 1);
  }
  return new Set([...counts].flatMap(([address, count]) => count >= REGULAR_THREADS ? [address] : []));
}

/**
 * Which messages a thread opens expanded: the newest, and the unread ones. Gmail counts a thread's UNREAD messages
 * (gmailSync.ts) without naming them, and they are the newest it received, so those are the newest `unread` not sent by
 * the user. The reader scrolls to the first of them, or to the newest when none is unread.
 */
export function openByDefault(messages: readonly { _id: string; isFromMe: boolean }[], unread: number): { open: Set<string>; target: string | undefined } {
  const unreadIds = unread > 0 ? messages.filter((message) => !message.isFromMe).slice(-unread).map((message) => message._id) : [];
  const newest = messages[messages.length - 1]?._id;
  const target = messages.find((message) => unreadIds.includes(message._id))?._id ?? newest;
  return { open: new Set([...unreadIds, ...(newest ? [newest] : [])]), target };
}

/** A file an email carries, as the reader and composer hold it. */
export interface MailFile {
  storageId: GenericId<"_storage">;
  filename: string;
  mimeType: string;
  size: number | null;
}

type StoredAttachment = {
  filename?: string; mimeType?: string; totalBytes?: number; originalStorageId?: GenericId<"_storage">; gmail?: { inline: boolean };
};

/** A message's files a reply all or forward can carry again: stored, and not an image the body shows inline. */
export function messageFiles(message: { attachments: readonly StoredAttachment[] }): MailFile[] {
  return message.attachments.flatMap((attachment) => attachment.originalStorageId && !attachment.gmail?.inline ? [{
    storageId: attachment.originalStorageId, filename: attachment.filename ?? "attachment",
    mimeType: attachment.mimeType ?? "application/octet-stream", size: attachment.totalBytes ?? null,
  }] : []);
}

/** Every distinct file in a thread, oldest first. The same file sent twice (a name and size seen before) counts once. */
export function threadFiles(messages: readonly { attachments: readonly StoredAttachment[] }[]): MailFile[] {
  const seen = new Set<string>();
  return messages.flatMap(messageFiles).filter((file) => {
    const key = `${file.filename}\u0000${file.size ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
