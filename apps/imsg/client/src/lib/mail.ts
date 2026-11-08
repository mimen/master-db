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
    "overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head>" +
    `<body>${body}</body></html>`;
}

/** The sandbox the iframe runs in: same origin so the reader can size it, popups for links, and never scripts. */
export const EMAIL_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

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
