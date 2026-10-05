import type { ChatSummary } from "@shared/types";
import { emailMatchKey, formatAddress, matchesAnyAddress, phoneMatchKey } from "@shared/address";
import { chatIsSMS } from "./chat-service";
import type { ContactListRow } from "./identity";
import type { NameOrder } from "./settings";

/** The fields contact-order derivations need — a subset of ContactListRow,
 * so callers (and tests) can pass minimal fixtures. */
export type NamedContact = Pick<ContactListRow, "display_name" | "first_name" | "last_name">;

/** A contact plus its derived row title and section-header letter, in final
 * display order for the given NameOrder. */
export interface ContactOrderRow<T extends NamedContact> {
  person: T;
  title: string;
  sectionLetter: string;
}

/** First alphabetic character, uppercased, or "#" for anything else (blank,
 * digit, symbol, emoji) — matches contacts-list-pane's existing bucket for
 * the default list. */
function letterFor(value: string): string {
  const c = value.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

/** The last-name-first key a person sorts/groups under in "last-first" mode:
 * last_name when present, else display_name — never blank as long as
 * display_name isn't (people without a display_name are already filtered out
 * server-side in listPeople). */
function lastKey(person: NamedContact): string {
  return person.last_name?.trim() || person.display_name;
}

/**
 * "Last, First" label for a person, falling back to whichever structured
 * part IS present, and to display_name when neither is — so a person with
 * only a last name (or only a first name, or no structured name at all)
 * never renders a bare leading/trailing comma.
 */
export function lastFirstLabel(person: NamedContact): string {
  const first = person.first_name?.trim();
  const last = person.last_name?.trim();
  if (first && last) return `${last}, ${first}`;
  if (last) return last;
  if (first) return first;
  return person.display_name;
}

/** Row title for a person under `order`. "first-last" (default) is exactly
 * today's display_name — no change. "last-first" is lastFirstLabel. */
export function contactTitle(person: NamedContact, order: NameOrder): string {
  return order === "last-first" ? lastFirstLabel(person) : person.display_name;
}

/** Section-header letter for a person under `order`. "first-last" keys off
 * display_name's initial (today's unchanged behavior); "last-first" keys off
 * the last-name initial (falling back to display_name when there's no
 * last_name). */
export function contactSectionLetter(person: NamedContact, order: NameOrder): string {
  return letterFor(order === "last-first" ? lastKey(person) : person.display_name);
}

/**
 * Orders `people` and derives each row's title + section letter for `order`.
 *
 * "first-last" (default) passes the input through UNCHANGED — callers feed
 * it the server's already display_name-sorted list, and re-sorting here
 * (even with an equivalent comparator) risks a subtly different tie-break
 * order than today's. Only "last-first" re-sorts, by (last_name, first_name)
 * with the same display_name fallback as lastFirstLabel/contactSectionLetter.
 */
export function orderContacts<T extends NamedContact>(
  people: readonly T[],
  order: NameOrder,
): ContactOrderRow<T>[] {
  const source = order === "last-first" ? [...people].sort(byLastFirst) : people;
  return source.map((person) => ({
    person,
    title: contactTitle(person, order),
    sectionLetter: contactSectionLetter(person, order),
  }));
}

function byLastFirst(a: NamedContact, b: NamedContact): number {
  const lastCompare = lastKey(a).localeCompare(lastKey(b));
  if (lastCompare !== 0) return lastCompare;
  return (a.first_name?.trim() ?? "").localeCompare(b.first_name?.trim() ?? "");
}

/** The fields the favorites grouping needs — NamedContact plus the flag. */
export type FavoritableContact = NamedContact & Pick<ContactListRow, "is_favorite">;

export interface GroupedContacts<T extends FavoritableContact> {
  /** Every favorited person, in `order`'s name order, no section letters —
   * a pinned shortcut atop the list (iOS Contacts style), not a separate
   * ownership bucket. [] when nobody is favorited, so callers render no
   * section at all. */
  favorites: ContactOrderRow<T>[];
  /** The full A–Z list, byte-identical to plain `orderContacts(people,
   * order)` — favorited people still appear here too, in their letter
   * section, unchanged. */
  alpha: ContactOrderRow<T>[];
}

/**
 * Splits `people` into a pinned favorites list plus the unchanged A–Z list,
 * for the "★ Favorites" section atop Contacts. Membership in `favorites`
 * never removes a person from `alpha` — it's a shortcut, not a move — so
 * `alpha` is always exactly `orderContacts(people, order)`.
 */
export function groupContacts<T extends FavoritableContact>(
  people: readonly T[],
  order: NameOrder,
): GroupedContacts<T> {
  const favorites = orderContacts(
    people.filter((p) => p.is_favorite === true),
    order,
  );
  return { favorites, alpha: orderContacts(people, order) };
}

// ---------------------------------------------------------------- Signal Contacts


/** The three service colors a handle can carry: blue, green, gray. */
export type HandleService = "iMessage" | "SMS" | "Other";

type Reachable = Pick<ContactListRow, "normalized_phones" | "normalized_emails">;

function handlesOf(person: Reachable): string[] {
  return [...person.normalized_phones, ...person.normalized_emails];
}

/** Looks up the service Comma reaches a handle on. Build once per chat list. */
export type ServiceLookup = (handle: string) => HandleService;

/**
 * Indexes one-to-one threads by handle: a handle reaches over whatever its
 * newest thread uses, and with no thread it defaults to iMessage, the only
 * service an email can use.
 */
export function serviceIndex(chats: readonly ChatSummary[]): ServiceLookup {
  const newest = new Map<string, { at: number; sms: boolean }>();
  for (const chat of chats) {
    if (chat.isGroup) continue;
    const address = chat.participants[0]?.address;
    const key = address ? phoneMatchKey(address) || emailMatchKey(address) : "";
    if (!key) continue;
    const at = chat.lastMessage?.dateCreated ?? 0;
    const prior = newest.get(key);
    if (!prior || at > prior.at) newest.set(key, { at, sms: chatIsSMS(chat.guid) });
  }
  return (handle) => {
    const hit = newest.get(phoneMatchKey(handle) || emailMatchKey(handle));
    return hit?.sms ? "SMS" : "iMessage";
  };
}

export type ContactRow<T> =
  | { kind: "section"; key: string; label: string; count?: number; letter?: string }
  | { kind: "person"; key: string; person: T; title: string };

/**
 * Favorites, then Recent (the people messaged last), then A to Z. Each person
 * appears once, in the first section that claims them.
 */
export function contactSections<T extends FavoritableContact & { _id: string }>(
  people: readonly T[],
  order: NameOrder,
  recentIds: readonly string[],
): ContactRow<T>[] {
  const rows: ContactRow<T>[] = [];
  const { favorites, alpha } = groupContacts(people, order);
  if (favorites.length > 0) {
    rows.push({ kind: "section", key: "s-favorites", label: "Favorites", count: favorites.length, letter: "★" });
    for (const { person, title } of favorites) rows.push({ kind: "person", key: `f-${person._id}`, person, title });
  }
  const recentSet = new Set(recentIds);
  const recent = recentIds
    .map((id) => alpha.find((r) => r.person._id === id))
    .filter((r): r is ContactOrderRow<T> => r !== undefined && !r.person.is_favorite);
  if (recent.length > 0) {
    rows.push({ kind: "section", key: "s-recent", label: "Recent" });
    for (const { person, title } of recent) rows.push({ kind: "person", key: `r-${person._id}`, person, title });
  }
  let last: string | null = null;
  for (const { person, title, sectionLetter } of alpha) {
    if (person.is_favorite || recentSet.has(person._id)) continue;
    if (sectionLetter !== last) {
      rows.push({ kind: "section", key: `s-${sectionLetter}`, label: sectionLetter, letter: sectionLetter });
      last = sectionLetter;
    }
    rows.push({ kind: "person", key: person._id, person, title });
  }
  return rows;
}

/** Person ids in the order you last messaged them one-to-one, up to `limit`. */
export function recentPeopleIds<T extends Reachable & { _id: string }>(
  people: readonly T[],
  chats: readonly ChatSummary[],
  limit: number,
): string[] {
  const dms = chats
    .filter((c) => !c.isGroup && c.lastMessage)
    .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
  const out: string[] = [];
  for (const chat of dms) {
    const address = chat.participants[0]?.address;
    if (!address) continue;
    const person = people.find((p) => matchesAnyAddress(address, handlesOf(p)));
    if (person && !out.includes(person._id)) out.push(person._id);
    if (out.length >= limit) break;
  }
  return out;
}

type Searchable = Reachable & Pick<ContactListRow, "display_name" | "first_name" | "last_name" | "nickname" | "organization">;

/** Search people, numbers and orgs: any name part, the organization, or a phone's digits. */
export function matchesContact(person: Searchable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const terms = [person.display_name, person.first_name, person.last_name, person.nickname, person.organization];
  if (terms.some((t) => t?.toLowerCase().includes(needle))) return true;
  if (person.normalized_emails.some((e) => e.toLowerCase().includes(needle))) return true;
  const digits = /^[+\d\s().-]+$/.test(needle) ? needle.replace(/\D/g, "") : "";
  return digits.length >= 3 && person.normalized_phones.some((p) => p.replace(/\D/g, "").includes(digits));
}

export interface DuplicatePair<T> {
  /** The record with more history: the default Keep. */
  readonly keep: T;
  readonly other: T;
}

/**
 * People sharing a name across different handles, as pairs to review. The
 * busier record is the default Keep. Pairs the owner marked "Not the same
 * person" are skipped.
 */
export function findDuplicates<T extends Reachable & { _id: string; display_name: string; message_count?: number; not_duplicate_of?: string[] }>(
  people: readonly T[],
): DuplicatePair<T>[] {
  const byName = new Map<string, T[]>();
  for (const p of people) {
    const key = p.display_name.trim().toLowerCase();
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const pairs: DuplicatePair<T>[] = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (b.message_count ?? 0) - (a.message_count ?? 0));
    const [keep, ...rest] = sorted;
    for (const other of rest) {
      if (keep.not_duplicate_of?.includes(other._id) || other.not_duplicate_of?.includes(keep._id)) continue;
      pairs.push({ keep, other });
    }
  }
  return pairs;
}

/** The row's second line: the organization, else the message count, else nothing. */
export function contactSecondary(person: Pick<ContactListRow, "organization" | "message_count">): string {
  if (person.organization?.trim()) return person.organization.trim();
  const n = person.message_count ?? 0;
  return n > 0 ? `${n.toLocaleString("en-US")} ${n === 1 ? "message" : "messages"}` : "";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact age: 40m, 5h, 2d, then the date ("Sep 12"). */
export function compactAge(ms: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Your turn 5h" when the conversation waits on you, else its last activity's age. */
export function conversationState(chat: ChatSummary, now: number): { label: string; yourTurn: boolean } {
  const last = chat.lastMessage;
  if (!last) return { label: "", yourTurn: false };
  if (chat.flags.unresponded && !last.isFromMe) {
    return { label: `Your turn ${compactAge(last.dateCreated, now)}`, yourTurn: true };
  }
  return { label: compactAge(last.dateCreated, now), yourTurn: false };
}

/** "Shared group with Marissa, Taylor and Jordan": the other members by first name. */
export function sharedGroupLine(chat: ChatSummary, personHandles: readonly string[]): string {
  const names = chat.participants
    .filter((p) => !matchesAnyAddress(p.address, [...personHandles]))
    .map((p) => (p.name ? p.name.split(" ")[0] : formatAddress(p.address)));
  if (names.length === 0) return "Shared group";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Shared group with ${list}`;
}

export interface HandleRow {
  readonly key: string;
  /** "phone", "phone 2", "email", or the network's name. */
  readonly label: string;
  readonly value: string;
  readonly display: string;
  readonly service: HandleService;
  /** Comma can send here, so it can be primary. */
  readonly reachable: boolean;
  readonly primary: boolean;
}

const NETWORK_LABELS: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
  signal: "Signal",
  matrix: "Matrix",
  gmessages: "Google Messages",
  twitter: "X",
};

/**
 * Every handle on the person page: phones and emails first, labeled and
 * carrying their service and primary state, then other networks Comma can't
 * send to.
 */
export function handleRows(
  person: Reachable & { primary_handle?: string },
  identities: ReadonlyArray<{ kind: string; network?: string; value: string; normalized: string }>,
  serviceOf: ServiceLookup,
): HandleRow[] {
  const primary = person.primary_handle ?? person.normalized_phones[0] ?? person.normalized_emails[0];
  const rows: HandleRow[] = [];
  person.normalized_phones.forEach((phone, i) => {
    rows.push({
      key: phone, label: i === 0 ? "phone" : `phone ${i + 1}`, value: phone, display: formatAddress(phone),
      service: serviceOf(phone), reachable: true, primary: phone === primary,
    });
  });
  person.normalized_emails.forEach((email, i) => {
    rows.push({
      key: email, label: i === 0 ? "email" : `email ${i + 1}`, value: email, display: email,
      service: serviceOf(email), reachable: true, primary: email === primary,
    });
  });
  const known = new Set(handlesOf(person));
  for (const identity of identities) {
    if (identity.kind === "phone" || identity.kind === "email" || known.has(identity.normalized)) continue;
    const network = identity.network ?? identity.kind;
    const label = NETWORK_LABELS[network] ?? NETWORK_LABELS[identity.kind];
    if (!label) continue;
    known.add(identity.normalized);
    rows.push({
      key: `${network}:${identity.value}`, label, value: identity.value, display: identity.value,
      service: "Other", reachable: false, primary: false,
    });
  }
  return rows;
}

/** A first name and organization guessed from an unknown sender's message ("This is Rae from The Loft"). */
export function guessFromMessage(text: string | undefined): { first?: string; organization?: string } {
  if (!text) return {};
  const first = /\b(?:this is|it's|it is|i'm|i am)\s+([A-Z][a-z]+)\b/i.exec(text)?.[1];
  // "The Loft" or "Night Shift Collective", never a lone first name ("from Tracy").
  const organization = /\b(?:from|at|with)\s+(The\s+[A-Z][\w'&]*(?:\s+[A-Z][\w'&]*)*|[A-Z][\w'&]*(?:\s+[A-Z][\w'&]*)+)/.exec(text)?.[1];
  return {
    ...(first ? { first: first[0].toUpperCase() + first.slice(1).toLowerCase() } : {}),
    ...(organization ? { organization } : {}),
  };
}

/** "Night Shift Collective. 1,284 messages since 2022" under the person's name. */
export function personSubline(person: { organization?: string; message_count?: number; created_at?: string }): string {
  const parts: string[] = [];
  if (person.organization?.trim()) parts.push(person.organization.trim());
  const n = person.message_count ?? 0;
  if (n > 0) {
    const year = person.created_at ? new Date(person.created_at).getFullYear() : NaN;
    parts.push(`${n.toLocaleString("en-US")} ${n === 1 ? "message" : "messages"}${Number.isNaN(year) ? "" : ` since ${year}`}`);
  }
  return parts.join(". ");
}
