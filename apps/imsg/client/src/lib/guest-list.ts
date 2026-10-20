import type { GuestListEvent, Person } from "@/lib/identity";

export type GuestContact = { firstName: string; lastName: string; email: string };

export type GuestRowState = "on-list" | "closed" | "open";

/** What one upcoming event offers this person. Milad's list is uncapped, so only the comp deadline closes it. */
export function guestRowState(event: GuestListEvent, personEmails: readonly string[], now: number): GuestRowState {
  if (personEmails.some((e) => event.guestEmails.includes(e.toLowerCase()))) return "on-list";
  return event.deadline && Date.parse(event.deadline) < now ? "closed" : "open";
}

/** Prism requires all three, so a contact missing any of them gets the inline form instead of a one-tap add. */
export function guestContact(person: Pick<Person, "first_name" | "last_name" | "display_name" | "normalized_emails">): GuestContact {
  const [first = "", ...rest] = (person.display_name ?? "").trim().split(/\s+/);
  return {
    firstName: person.first_name ?? first,
    lastName: person.last_name ?? rest.join(" "),
    email: person.normalized_emails[0] ?? "",
  };
}

export function isCompleteContact(c: GuestContact): boolean {
  return c.firstName.trim() !== "" && c.lastName.trim() !== "" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim());
}

/** The event after a confirmed add, so the row flips to "On list" without refetching. */
export function withGuest(event: GuestListEvent, email: string): GuestListEvent {
  return { ...event, guestEmails: [...event.guestEmails, email.trim().toLowerCase()] };
}
