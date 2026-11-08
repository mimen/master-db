/**
 * The Mail workspace's pure rules: which threads each lens shows, and the document an email's cleaned HTML renders in.
 * Convex cleans the HTML (convex/comma/emailHtml.ts); the reader shows it in an iframe with no scripts, under a CSP
 * that blocks every remote load until the user asks for images, so either layer alone keeps a script out.
 */

export type MailLens = "people" | "all";

export interface MailRow {
  known: boolean;
  gmail?: { bulk: boolean };
  flags: { unresponded: boolean };
}

/** People: someone who resolves to a person wrote last and is owed a reply. All inbox: everything in the inbox. */
export function inLens(row: MailRow, lens: MailLens): boolean {
  return lens === "all" || (row.known && !row.gmail?.bulk && row.flags.unresponded);
}

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
