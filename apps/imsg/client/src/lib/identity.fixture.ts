import { useSyncExternalStore } from "react";

export { convexClient } from "./convex.fixture";
import type {
  AirtableEventRow,
  AirtableHumanRow,
  ChatCrm,
  ContactListRow,
  EventLink,
  IdentityRow,
  Priority,
  WhoIsResult,
} from "./identity";

export type {
  AirtableEventRow,
  AirtableHumanRow,
  ChatCrm,
  ContactListRow,
  EventLink,
  IdentityRow,
  Person,
  Priority,
  WhoIsResult,
} from "./identity";

type FixturePerson = ContactListRow & {
  notes?: string;
  notes_updated_at?: string;
  identities: IdentityRow[];
  merged_into?: string;
};

function phone(value: string, extra: Partial<IdentityRow> = {}): IdentityRow {
  return { kind: "phone", source: "apple_contact", value, normalized: value, chat_count: 1, ...extra };
}

/**
 * A small in-memory identity store so the fixture's Contacts edits (merge,
 * primary, notes, tags) show on screen. Names and numbers match
 * e2e/fixture/world.ts; the extra people seed a duplicate pair and an email.
 */
function seedPeople(): FixturePerson[] {
  return [
    {
      _id: "fixture-alex",
      display_name: "Alex Rivera",
      first_name: "Alex",
      last_name: "Rivera",
      organization: "Night Shift Collective",
      is_favorite: true,
      priority: 1,
      tags: ["promoter", "showcase"],
      events: [
        { id: "evt-1", name: "Umbrella Weekend", linkId: "fixture-link-1", start_date: "2026-10-10T19:00:00" },
        { id: "evt-3", name: "Coffee with Alex", linkId: "fixture-link-3", start_date: "2026-10-24T10:30:00" },
      ],
      notes: "Runs the Saturday showcase. Prefers set times by Thursday night.",
      notes_updated_at: "2026-09-30T17:00:00.000Z",
      message_count: 1284,
      created_at: "2022-03-14T00:00:00.000Z",
      normalized_phones: ["+16195550101"],
      normalized_emails: ["alex@nightshift.example"],
      identities: [
        phone("+16195550101"),
        { kind: "email", source: "apple_contact", value: "alex@nightshift.example", normalized: "alex@nightshift.example", chat_count: 0 },
        { kind: "instagram", network: "instagram", source: "participant", value: "@alex.nightshift", normalized: "@alex.nightshift", chat_count: 0 },
      ],
    },
    {
      _id: "fixture-jordan",
      display_name: "Jordan Lee",
      first_name: "Jordan",
      last_name: "Lee",
      priority: 3,
      tags: ["production"],
      message_count: 611,
      created_at: "2023-01-09T00:00:00.000Z",
      normalized_phones: ["+16195550102"],
      normalized_emails: [],
      identities: [phone("+16195550102")],
    },
    {
      _id: "fixture-sam",
      display_name: "Sam Chen",
      first_name: "Sam",
      last_name: "Chen",
      organization: "AUF",
      message_count: 88,
      created_at: "2024-05-01T00:00:00.000Z",
      normalized_phones: ["+16195550103"],
      normalized_emails: [],
      identities: [phone("+16195550103")],
    },
    {
      _id: "fixture-maya",
      display_name: "Maya Patel",
      first_name: "Maya",
      last_name: "Patel",
      organization: "Okafor Studio",
      tags: ["design"],
      message_count: 132,
      created_at: "2022-08-01T00:00:00.000Z",
      normalized_phones: ["+16195550104"],
      normalized_emails: ["maya@okafor.example"],
      identities: [
        phone("+16195550104"),
        { kind: "email", source: "apple_contact", value: "maya@okafor.example", normalized: "maya@okafor.example", chat_count: 0 },
      ],
    },
    {
      _id: "fixture-rae",
      display_name: "Rae Thompson",
      first_name: "Rae",
      last_name: "Thompson",
      message_count: 2,
      created_at: "2024-02-11T00:00:00.000Z",
      normalized_phones: ["+16195550188"],
      normalized_emails: [],
      identities: [phone("+16195550188")],
    },
    {
      _id: "fixture-maya-2",
      display_name: "Maya Patel",
      first_name: "Maya",
      message_count: 9,
      created_at: "2025-08-03T00:00:00.000Z",
      normalized_phones: ["+16195550105"],
      normalized_emails: [],
      identities: [phone("+16195550105", { source: "participant", first_seen_at: "2025-08-03T00:00:00.000Z" })],
    },
  ];
}

let people = seedPeople();
const listeners = new Set<() => void>();

function commit(next: FixturePerson[]): null {
  people = next;
  for (const listener of listeners) listener();
  return null;
}

function patch(personId: string, change: (p: FixturePerson) => FixturePerson): null {
  return commit(people.map((p) => (p._id === personId ? change(p) : p)));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The reader takes the snapshot, so the React Compiler sees the dependency and re-runs it on every write. */
function useStore<T>(read: (snapshot: FixturePerson[]) => T): T {
  return read(useSyncExternalStore(subscribe, () => people, () => people));
}

function live(snapshot: FixturePerson[] = people): FixturePerson[] {
  return snapshot.filter((p) => !p.merged_into);
}

function owner(handle: string, snapshot: FixturePerson[] = people): FixturePerson | undefined {
  const digits = handle.replace(/\D/g, "").slice(-10);
  return live(snapshot).find((p) =>
    p.normalized_emails.includes(handle.toLowerCase()) ||
    (digits.length >= 7 && p.normalized_phones.some((n) => n.replace(/\D/g, "").endsWith(digits))));
}

function normalize(handle: string): string {
  const digits = handle.replace(/\D/g, "");
  if (handle.includes("@")) return handle.trim().toLowerCase();
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

const groupCrm: Record<string, ChatCrm> = {
  "iMessage;+;fixture-crew": {
    is_favorite: true,
    priority: 2,
    tags: ["launch"],
    events: [{ id: "evt-2", name: "Summer Launch", linkId: "fixture-link-2" }],
  },
};

export function useWhoIs(handle: string | null): WhoIsResult | undefined {
  return useStore((snapshot) => {
    if (!handle) return undefined;
    const person = owner(handle, snapshot);
    if (!person) return { found: false, normalized: handle };
    const { identities, tags, events, ...rest } = person;
    return {
      found: true,
      normalized: handle,
      person: {
        ...rest,
        identity_count: identities.length,
        message_count: person.message_count ?? 0,
        is_self: false,
      },
      tags: tags ?? [],
      events: events ?? [],
      identities,
    };
  });
}

export function useListPeople(): ContactListRow[] | undefined {
  // Name-sorted, the same contract identity/queries:listPeople keeps.
  return useStore((snapshot) => live(snapshot)
    .map(({ identities: _identities, notes: _notes, ...row }) => row)
    .sort((a, b) => a.display_name.localeCompare(b.display_name)));
}

export function useCreatePerson(): (args: {
  handle: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  organization?: string;
}) => Promise<{ created: boolean; personId: string }> {
  return async (args) => {
    const existing = owner(args.handle);
    if (existing) return { created: false, personId: existing._id };
    const normalized = normalize(args.handle);
    const personId = `fixture-new-${people.length}`;
    const display = args.display_name || [args.first_name, args.last_name].filter(Boolean).join(" ") || normalized;
    commit([...people, {
      _id: personId,
      display_name: display,
      first_name: args.first_name,
      last_name: args.last_name,
      organization: args.organization,
      message_count: 0,
      normalized_phones: normalized.includes("@") ? [] : [normalized],
      normalized_emails: normalized.includes("@") ? [normalized] : [],
      identities: [{ kind: normalized.includes("@") ? "email" : "phone", source: "manual", value: args.handle, normalized, chat_count: 0 }],
    }]);
    return { created: true, personId };
  };
}

export function useSearchAirtableHumans(): (args: { query: string }) => Promise<AirtableHumanRow[]> {
  return async () => [];
}

export function useAddPersonFromAirtable(): (args: {
  record_id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
}) => Promise<{ personId: string }> {
  return async () => ({ personId: "fixture-person" });
}

export function useRenamePerson(): (args: {
  personId: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  organization?: string;
}) => Promise<null> {
  return async ({ personId, display_name, ...parts }) =>
    patch(personId, (p) => {
      const first = parts.first_name ?? p.first_name;
      const last = parts.last_name ?? p.last_name;
      return {
        ...p,
        ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v?.trim() || undefined])),
        display_name: display_name?.trim() || [first, last].filter(Boolean).join(" ") || p.display_name,
      };
    });
}

export function useSetFavorite(): (args: { personId: string; is_favorite: boolean }) => Promise<null> {
  return async ({ personId, is_favorite }) => patch(personId, (p) => ({ ...p, is_favorite }));
}

export function useSetPriority(): (args: { personId: string; priority?: Priority | null }) => Promise<null> {
  return async ({ personId, priority }) => patch(personId, (p) => ({ ...p, priority: priority ?? undefined }));
}

export function useAddTag(): (args: { personId: string; tag: string }) => Promise<null> {
  return async ({ personId, tag }) =>
    patch(personId, (p) => {
      const t = tag.trim().toLowerCase();
      return p.tags?.includes(t) ? p : { ...p, tags: [...(p.tags ?? []), t].sort() };
    });
}

export function useRemoveTag(): (args: { personId: string; tag: string }) => Promise<null> {
  return async ({ personId, tag }) => patch(personId, (p) => ({ ...p, tags: (p.tags ?? []).filter((t) => t !== tag) }));
}

export function useSetNotes(): (args: { personId: string; notes: string }) => Promise<null> {
  return async ({ personId, notes }) =>
    patch(personId, (p) => ({ ...p, notes: notes.trim() || undefined, notes_updated_at: new Date().toISOString() }));
}

export function useSetPrimaryHandle(): (args: { personId: string; handle: string }) => Promise<null> {
  return async ({ personId, handle }) => patch(personId, (p) => ({ ...p, primary_handle: handle }));
}

export function useAddHandle(): (args: { personId: string; handle: string }) => Promise<null> {
  return async ({ personId, handle }) => {
    const normalized = normalize(handle);
    const taken = owner(handle);
    if (taken && taken._id !== personId) throw new Error("That handle belongs to another contact");
    return patch(personId, (p) => normalized.includes("@")
      ? { ...p, normalized_emails: [...p.normalized_emails, normalized] }
      : { ...p, normalized_phones: [...p.normalized_phones, normalized] });
  };
}

export function useMergePeople(): (args: { keepId: string; mergeId: string }) => Promise<null> {
  return async ({ keepId, mergeId }) => {
    const gone = people.find((p) => p._id === mergeId);
    if (!gone) return null;
    return commit(people.map((p) => {
      if (p._id === mergeId) return { ...p, merged_into: keepId };
      if (p._id !== keepId) return p;
      return {
        ...p,
        normalized_phones: [...p.normalized_phones, ...gone.normalized_phones],
        normalized_emails: [...p.normalized_emails, ...gone.normalized_emails],
        identities: [...p.identities, ...gone.identities],
        tags: [...new Set([...(p.tags ?? []), ...(gone.tags ?? [])])].sort(),
        message_count: (p.message_count ?? 0) + (gone.message_count ?? 0),
        organization: p.organization ?? gone.organization,
      };
    }));
  };
}

export function useMarkNotDuplicate(): (args: { personId: string; otherId: string }) => Promise<null> {
  return async ({ personId, otherId }) => commit(people.map((p) =>
    p._id === personId ? { ...p, not_duplicate_of: [...(p.not_duplicate_of ?? []), otherId] }
      : p._id === otherId ? { ...p, not_duplicate_of: [...(p.not_duplicate_of ?? []), personId] }
        : p));
}

export function useListTags(): Array<{ tag: string; count: number }> | undefined {
  return useStore((snapshot) => {
    const counts = new Map<string, number>();
    for (const p of live(snapshot)) for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count }));
  });
}

export function useChatCrm(chatGuid: string | null): ChatCrm | undefined {
  return chatGuid ? (groupCrm[chatGuid] ?? { tags: [], events: [] }) : undefined;
}

export function useSetChatFavorite(): (args: { chatGuid: string; is_favorite: boolean }) => Promise<null> {
  return async () => null;
}

export function useSetChatPriority(): (args: { chatGuid: string; priority?: Priority | null }) => Promise<null> {
  return async () => null;
}

export function useAddChatTag(): (args: { chatGuid: string; tag: string }) => Promise<null> {
  return async () => null;
}

export function useRemoveChatTag(): (args: { chatGuid: string; tag: string }) => Promise<null> {
  return async () => null;
}

export function useSearchEvents(): (args: { query: string }) => Promise<AirtableEventRow[]> {
  return async () => [];
}

export function useLinkEvent(): (args: {
  personId?: string;
  chatGuid?: string;
  airtable_event_id: string;
  event_name: string;
  start_date?: string;
}) => Promise<{ linkId: string }> {
  return async ({ personId, airtable_event_id, event_name, start_date }) => {
    const linkId = `fixture-link-${airtable_event_id}`;
    const link: EventLink = { id: airtable_event_id, name: event_name, linkId, start_date };
    if (personId) patch(personId, (p) => ({ ...p, events: [...(p.events ?? []), link] }));
    return { linkId };
  };
}

export function useUnlinkEvent(): (args: { linkId: string }) => Promise<null> {
  return async ({ linkId }) => commit(people.map((p) => ({ ...p, events: p.events?.filter((e) => e.linkId !== linkId) })));
}

export function primaryHandle(p: Pick<ContactListRow, "normalized_phones" | "normalized_emails" | "primary_handle">): string | null {
  return p.primary_handle ?? p.normalized_phones[0] ?? p.normalized_emails[0] ?? null;
}
