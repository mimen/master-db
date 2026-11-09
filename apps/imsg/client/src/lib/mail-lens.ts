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
