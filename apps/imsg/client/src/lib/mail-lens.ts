/** Which threads each Mail lens shows. Apart from mail.ts so Today reads People without the reader's code. */

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
