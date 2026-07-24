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
