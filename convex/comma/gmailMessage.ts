import { normalizeEmail } from "../../apps/imsg/shared/address";
import { QUOTE_START } from "../../apps/imsg/shared/email-quote";
import type { ModelText, ToModelText } from "../../apps/imsg/shared/model-text";

import { cleanEmailHtml, htmlToText } from "./emailHtml";

/**
 * One Gmail API message (users.messages or a thread's messages, format metadata or full) as Comma keeps it: its
 * addresses, subject and labels, whether it is bulk mail, its plain text, and its HTML cleaned for the reader.
 */

export type EmailAddress = { address: string; name: string | null };

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: number;
  labelIds: string[];
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  snippet: string;
  bulk: boolean;
  /** The plain body, quoted history included; the snippet for bulk mail, which is read as headers only. */
  text: string;
  /** Cleaned HTML (emailHtml.ts), when the message has an HTML part and was read in full. */
  html?: string;
  blockedImages?: number;
  /** What every model reads (gmailModelText). */
  model: ModelText;
  /** Its attachment parts; empty for a metadata read. */
  attachments: GmailAttachment[];
};

/** A MIME part with a filename. `inline`: the HTML body shows it through `cid:`, so the reader draws it there. */
export type GmailAttachment = { partId: string; filename: string; mimeType: string; size: number; contentId?: string; inline: boolean };

/** The headers bulk screening and the reader need; a metadata read asks for exactly these. */
export const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"] as const;

const TEXT_LIMIT = 20_000;
/** Above this the reader shows the plain text; a Convex document holds at most 1 MiB. */
const HTML_LIMIT = 300_000;

export type Part = {
  partId?: string; mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[]; headers?: { name: string; value: string }[];
};
export type RawGmailMessage = { id: string; threadId: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: Part };

/** Gmail's base64url body data as text. */
// ponytail: decodes every part as UTF-8, which is what Gmail serves for nearly all mail; read the part's charset if a mailbox shows mojibake.
export function decodeBody(data: string): string {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** An RFC 5322 address list, as Gmail returns it: `"Last, First" <a@b.c>, d@e.f`. */
export function parseAddresses(header: string | undefined): EmailAddress[] {
  if (!header) return [];
  const entries: string[] = [""];
  let quoted = false;
  let angled = false;
  for (const char of header) {
    if (char === "\"" ) quoted = !quoted;
    else if (char === "<" && !quoted) angled = true;
    else if (char === ">" && !quoted) angled = false;
    if (char === "," && !quoted && !angled) entries.push("");
    else entries[entries.length - 1] += char;
  }
  return entries.flatMap((entry) => {
    const angle = /^(.*)<([^>]*)>\s*$/s.exec(entry.trim());
    const address = normalizeEmail(angle ? angle[2]! : entry);
    if (!address) return [];
    const name = angle?.[1]!.trim().replace(/^"(.*)"$/s, "$1").replace(/\\(.)/g, "$1").trim();
    return [{ address, name: name || null }];
  });
}

const BULK_LABELS = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"]);
const BULK_SENDER = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|newsletters?|news|marketing|bounces?|alerts?)([+._-]|$)/i;

/** Mail sent to a list or by a machine: newsletters, notifications, promotions. Read from headers, labels and the sender. */
export function isBulk(headers: Map<string, string>, labelIds: readonly string[], from: string): boolean {
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return true;
  if (/^(bulk|list|junk)$/i.test(headers.get("precedence")?.trim() ?? "")) return true;
  const auto = headers.get("auto-submitted")?.trim().toLowerCase();
  if (auto && auto !== "no") return true;
  return labelIds.some((label) => BULK_LABELS.has(label)) || BULK_SENDER.test(from.split("@")[0] ?? "");
}

type Found = { text?: string; html?: string; files: Part[] };

/** The first plain and HTML bodies, and every part with a filename, which Gmail serves as an attachment. */
function bodies(part: Part | undefined, found: Found = { files: [] }): Found {
  if (!part) return found;
  if (part.filename && part.partId !== undefined && (part.body?.attachmentId || part.body?.data)) {
    found.files.push(part);
    return found;
  }
  if (part.body?.data && part.mimeType === "text/plain" && found.text === undefined) found.text = decodeBody(part.body.data);
  if (part.body?.data && part.mimeType === "text/html" && found.html === undefined) found.html = decodeBody(part.body.data);
  for (const child of part.parts ?? []) bodies(child, found);
  return found;
}

/** The part a partId names, for the download to read its current attachmentId or inline data. */
export function findPart(part: Part | undefined, partId: string): Part | undefined {
  if (!part) return undefined;
  if (part.partId === partId) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, partId);
    if (found) return found;
  }
  return undefined;
}

const contentIdOf = (part: Part) => part.headers?.find((header) => header.name.toLowerCase() === "content-id")?.value.trim().replace(/^<|>$/g, "");

function attachmentsOf(files: Part[], html: string | undefined): GmailAttachment[] {
  return files.map((part) => {
    const contentId = contentIdOf(part);
    return {
      partId: part.partId!, filename: part.filename!, mimeType: part.mimeType || "application/octet-stream", size: part.body?.size ?? 0,
      ...(contentId ? { contentId } : {}), inline: contentId !== undefined && html !== undefined && html.includes(`cid:${contentId}`),
    };
  });
}

export function parseGmailMessage(raw: RawGmailMessage): GmailMessage {
  const headers = new Map((raw.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
  const labelIds = raw.labelIds ?? [];
  const from = parseAddresses(headers.get("from"))[0] ?? { address: "unknown@unknown.invalid", name: null };
  const bulk = isBulk(headers, labelIds, from.address);
  const found = bulk ? { files: [] } : bodies(raw.payload);
  const cleaned = found.html !== undefined ? cleanEmailHtml(found.html) : undefined;
  const text = (found.text ?? (found.html !== undefined ? htmlToText(found.html) : raw.snippet ?? "")).slice(0, TEXT_LIMIT);
  const subject = headers.get("subject")?.trim() ?? "";
  const body = bulk ? decodeEntities(text) : text;
  return {
    id: raw.id, threadId: raw.threadId, internalDate: Number(raw.internalDate ?? 0), labelIds, from,
    to: parseAddresses(headers.get("to")), cc: parseAddresses(headers.get("cc")), subject,
    snippet: decodeEntities(raw.snippet ?? ""), bulk, text: body,
    ...(cleaned && cleaned.html.length <= HTML_LIMIT ? { html: cleaned.html, blockedImages: cleaned.blockedImages } : {}),
    model: gmailModelText({ text: body, html: found.html, subject, threadId: raw.threadId }),
    attachments: attachmentsOf(found.files, found.html),
  };
}

/** Gmail's snippet arrives HTML-escaped. */
function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|amp|lt|gt|quot|#39);/g, (entity, code: string) =>
    code.startsWith("#") ? String.fromCharCode(Number(code.slice(1))) : ({ amp: "&", lt: "<", gt: ">", quot: "\"" } as Record<string, string>)[code]!);
}

/** A signature: the standard delimiter, or a phone's sign-off. */
const SIGNATURE_START = [/^-- ?$/m, /^Sent from my (iPhone|iPad|Android|phone)/im, /^Get Outlook for /im];

/** The new part of a plain-text email: quoted history, `>` lines and the signature gone. */
export function newContent(text: string): string {
  let cut = text.replace(/\r\n/g, "\n");
  for (const pattern of [...QUOTE_START, ...SIGNATURE_START]) {
    const match = pattern.exec(cut);
    if (match) cut = cut.slice(0, match.index);
  }
  return cut.split("\n").filter((line) => !line.startsWith(">")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A message as Gmail sends it: its plain text, its raw HTML part, its subject and thread. */
export type RawEmail = { text: string; html?: string; subject: string; threadId: string };

/**
 * Gmail's ToModelText: the new content only (quoted history, signatures and markup gone), read from the HTML when there
 * is one, since that is where mail clients mark the quote, plus the subject and the thread.
 */
export const gmailModelText: ToModelText<RawEmail> = (message): ModelText => {
  const fresh = newContent(message.html !== undefined ? htmlToText(message.html, { newOnly: true }) : message.text);
  return {
    ...(fresh && fresh !== message.text ? { modelText: fresh } : {}),
    ...(message.subject ? { subject: message.subject } : {}),
    threadRef: message.threadId,
  };
};
