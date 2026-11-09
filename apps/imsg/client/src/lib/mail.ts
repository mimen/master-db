/**
 * The Mail workspace's pure rules for the document an email's cleaned HTML renders in, and for replies. Convex cleans
 * the HTML (convex/comma/emailHtml.ts); the reader shows it in an iframe with no scripts, under a CSP that blocks every
 * remote load until the user asks for images, so either layer alone keeps a script out. The lenses are in mail-lens.ts.
 */

/** The iframe's whole document. `images`: the user asked for this message's remote images. */
export function emailDocument(html: string, { images }: { images: boolean }): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${images ? " https: http:" : ""}`;
  const body = images ? html.replace(/ data-comma-src="/g, ' src="') : html;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
    "<style>html,body{margin:0;background:#fff;color:#1d1d1f;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
    "overflow-wrap:anywhere}body{display:flow-root}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}" +
    "details.comma-fold>summary{display:inline-block;list-style:none;cursor:pointer;margin:4px 0;padding:0 7px;border-radius:7px;" +
    "background:#e8eaed;color:#5f6368;font-size:12px;line-height:14px;letter-spacing:1px}details.comma-fold>summary:hover{background:#dadce0}" +
    "details.comma-fold>summary::-webkit-details-marker{display:none}details.comma-fold[open]>summary{margin-bottom:8px}</style></head>" +
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

export interface MailAddress {
  address: string;
  name: string | null;
}

/** The message a reply answers, as the reader holds it. */
export interface ReplySource {
  isFromMe: boolean;
  from: MailAddress;
  to: readonly MailAddress[];
  cc: readonly MailAddress[];
}

export type ReplyMode = "reply" | "replyAll";

export interface EmailFields {
  to: string;
  cc: string;
  subject: string;
}

/** An address as a person types it into To: `Name <a@b.c>`, the name quoted when it holds a separator. */
export function formatAddress({ address, name }: MailAddress): string {
  if (!name) return address;
  return /[,;<>"]/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}" <${address}>` : `${name} <${address}>`;
}

/**
 * The To, Cc and subject a reply starts with, as Gmail fills them. Reply answers the sender, or, on the user's own
 * message, its recipients. Reply all adds everyone else on it, never the user.
 */
export function replyFields(source: ReplySource, mode: ReplyMode, subject: string, self: ReadonlySet<string>): EmailFields {
  const seen = new Set(self);
  const keep = (addresses: readonly MailAddress[]) => addresses.filter(({ address }) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const first = source.isFromMe ? source.to : [source.from];
  const to = keep(mode === "replyAll" ? [...first, ...(source.isFromMe ? [] : source.to)] : first);
  const cc = mode === "replyAll" ? keep(source.cc) : [];
  return { to: to.map(formatAddress).join(", "), cc: cc.map(formatAddress).join(", "), subject: /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}` };
}

/** Whether a To or Cc field names at least one address. Convex reads the addresses out of the text. */
export const hasRecipient = (fields: Pick<EmailFields, "to" | "cc">) => /@/.test(fields.to) || /@/.test(fields.cc);
