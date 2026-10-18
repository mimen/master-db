import type { ChatSummary, Contact } from "@shared/types";

import type { AirtableHumanRow } from "@/lib/identity";

export type ComposeRow =
  | { kind: "raw"; key: string; contact: Contact }
  | { kind: "contact"; key: string; contact: Contact }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

export interface ComposeSection {
  title: string;
  rows: ComposeRow[];
}

const RECENT_LIMIT = 8;
const LOCAL_LIMIT = 6;

function normalize(address: string): string {
  return address.replace(/[^a-z0-9@+]/gi, "").toLowerCase();
}

/** Text that can be sent to as typed: an email, or a phone number of at least 7 digits. */
export function looksLikeAddress(text: string): boolean {
  const t = text.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true;
  return /^\+?[\d\s().-]+$/.test(t) && t.replace(/\D/g, "").length >= 7;
}

/** One-to-one conversations as recipients, most recent first. */
function directPeople(directory: readonly ChatSummary[]): Contact[] {
  return directory.flatMap((chat) => {
    const only = chat.participants[0];
    if (chat.isGroup || chat.isSpam || chat.participants.length !== 1 || !only) return [];
    return [{ address: only.address, name: only.name ?? chat.displayName }];
  });
}

/**
 * The new-message list. Empty query: recent people. Typing: an address row when the text is
 * sendable, people already in a conversation (instant), then the contact search and Airtable.
 * Each address appears once, and never for someone already added.
 */
export function composeSections(input: {
  query: string;
  recipients: readonly Contact[];
  directory: readonly ChatSummary[];
  contacts: readonly Contact[];
  airtable: readonly AirtableHumanRow[];
}): ComposeSection[] {
  const needle = input.query.trim().toLowerCase();
  const seen = new Set(input.recipients.map((r) => normalize(r.address)));
  const take = (contact: Contact): boolean => {
    const key = normalize(contact.address);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const row = (kind: "contact" | "raw", contact: Contact): ComposeRow => ({ kind, key: `${kind}-${normalize(contact.address)}`, contact });

  if (needle === "") {
    const recent = directPeople(input.directory).filter(take).slice(0, RECENT_LIMIT);
    return recent.length > 0 ? [{ title: "Recent", rows: recent.map((c) => row("contact", c)) }] : [];
  }

  const sections: ComposeSection[] = [];
  const raw = input.query.trim();
  if (looksLikeAddress(raw) && take({ address: raw, name: raw })) {
    sections.push({ title: "New number", rows: [row("raw", { address: raw, name: raw })] });
  }
  const digits = needle.replace(/\D/g, "");
  const local = directPeople(input.directory)
    .filter((c) => c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.address.replace(/\D/g, "").includes(digits)))
    .filter(take)
    .slice(0, LOCAL_LIMIT);
  const found = input.contacts.filter(take);
  const people = [...local, ...found].map((c) => row("contact", c));
  const airtable = input.airtable
    .filter((h) => {
      const address = h.phone ?? h.email;
      return !address || take({ address, name: h.display_name });
    })
    .map((h): ComposeRow => ({ kind: "airtable", key: `at-${h.record_id}`, human: h }));
  if (people.length > 0) sections.push({ title: "People", rows: people });
  if (airtable.length > 0) sections.push({ title: "From Airtable", rows: airtable });
  return sections;
}
