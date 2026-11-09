import { normalizeEmail } from "./address";

/**
 * Who a reply, reply all or forward goes to, and the subject and body it starts with, as Gmail fills them. Shared by
 * the Mail composer and the Convex tests that send its output through the Gmail lane.
 */

export interface MailAddress {
  address: string;
  name: string | null;
}

/** The message a reply or forward is made from, as the reader holds it. */
export interface ReplySource {
  isFromMe: boolean;
  from: MailAddress;
  to: readonly MailAddress[];
  cc: readonly MailAddress[];
}

export type ReplyMode = "reply" | "replyAll";

export interface Recipients {
  to: MailAddress[];
  cc: MailAddress[];
}

/** An address as a To header and a person typing one write it: `Name <a@b.c>`, the name quoted when it holds a separator. */
export function mailboxText({ address, name }: MailAddress): string {
  if (!name) return address;
  return /[,;<>"]/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}" <${address}>` : `${name} <${address}>`;
}

/**
 * The recipients a reply starts with. Reply answers the sender, or, on the user's own message, its recipients. Reply
 * all sends To the sender plus everyone on To, and Cc the message's Cc. The user's own addresses (`self`, lowercased:
 * the mailbox's selfHandles) are left out, and each address appears once, To first.
 */
export function replyRecipients(source: ReplySource, mode: ReplyMode, self: ReadonlySet<string>): Recipients {
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
  return { to, cc };
}

export const replySubject = (subject: string) => /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
export const forwardSubject = (subject: string) => /^fwd?:/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`;

/** The original under a forward: Gmail's "Forwarded message" block with its headers, then its text. */
export function forwardText(note: string, original: ReplySource & { date: number; subject: string; text: string }, timeZone?: string): string {
  const list = (addresses: readonly MailAddress[]) => addresses.map(mailboxText).join(", ");
  const when = new Date(original.date).toLocaleString("en-US", {
    weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}),
  });
  const block = [
    "---------- Forwarded message ---------", `From: ${mailboxText(original.from)}`, `Date: ${when}`, `Subject: ${original.subject}`,
    ...(original.to.length ? [`To: ${list(original.to)}`] : []), ...(original.cc.length ? [`Cc: ${list(original.cc)}`] : []), "", original.text,
  ].join("\n");
  return note.trim() ? `${note.trimEnd()}\n\n${block}` : block;
}

/** What a person typed into To or Cc, as addresses: `Name <a@b.c>` or a bare address, split on commas and semicolons. */
export function parseTyped(text: string): MailAddress[] {
  return text.split(/[,;\n]/).flatMap((entry) => {
    const angle = /^(.*)<([^>]*)>\s*$/s.exec(entry.trim());
    const address = normalizeEmail(angle ? angle[2]! : entry);
    if (!address) return [];
    const name = angle?.[1]!.trim().replace(/^"(.*)"$/s, "$1").trim();
    return [{ address, name: name || null }];
  });
}
