import type { ConvexReactClient } from "convex/react";
import type {
  AirtableEventRow,
  AirtableHumanRow,
  ChatCrm,
  ContactListRow,
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

/** Fixture provider value only. Fixture hooks below never subscribe to it. */
export const convexClient = Object.freeze({}) as ConvexReactClient;

const people: ContactListRow[] = [
  {
    _id: "fixture-alex",
    display_name: "Alex Rivera",
    first_name: "Alex",
    last_name: "Rivera",
    is_favorite: true,
    priority: 1,
    tags: ["promoter", "san-diego"],
    events: [{ id: "evt-1", name: "Umbrella Weekend", linkId: "fixture-link-1" }],
    normalized_phones: ["+16195550101"],
    normalized_emails: [],
  },
  {
    _id: "fixture-jordan",
    display_name: "Jordan Lee",
    first_name: "Jordan",
    last_name: "Lee",
    priority: 3,
    tags: ["production"],
    normalized_phones: ["+16195550102"],
    normalized_emails: [],
  },
  {
    _id: "fixture-sam",
    display_name: "Sam Chen",
    first_name: "Sam",
    last_name: "Chen",
    normalized_phones: ["+16195550103"],
    normalized_emails: [],
  },
];

const groupCrm: Record<string, ChatCrm> = {
  "iMessage;+;fixture-crew": {
    is_favorite: true,
    priority: 2,
    tags: ["launch"],
    events: [{ id: "evt-2", name: "Summer Launch", linkId: "fixture-link-2" }],
  },
};

export function useWhoIs(handle: string | null): WhoIsResult | undefined {
  if (!handle) return undefined;
  const person = people.find((candidate) =>
    [...candidate.normalized_phones, ...candidate.normalized_emails].includes(handle),
  );
  if (!person) return { found: false, normalized: handle };
  return {
    found: true,
    normalized: handle,
    person: {
      ...person,
      identity_count: 1,
      message_count: 8,
      is_self: false,
    },
    tags: person.tags ?? [],
    events: person.events ?? [],
    identities: [{
      kind: "phone",
      source: "fixture",
      value: handle,
      normalized: handle,
      display_name: person.display_name,
      chat_count: 1,
    }],
  };
}

export function useListPeople(): ContactListRow[] | undefined {
  return people;
}

export function useCreatePerson(): (args: {
  handle: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  organization?: string;
}) => Promise<{ created: boolean; personId: string }> {
  return async () => ({ created: false, personId: "fixture-person" });
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
  return async () => null;
}

export function useSetFavorite(): (args: { personId: string; is_favorite: boolean }) => Promise<null> {
  return async () => null;
}

export function useSetPriority(): (args: { personId: string; priority?: Priority | null }) => Promise<null> {
  return async () => null;
}

export function useAddTag(): (args: { personId: string; tag: string }) => Promise<null> {
  return async () => null;
}

export function useRemoveTag(): (args: { personId: string; tag: string }) => Promise<null> {
  return async () => null;
}

export function useListTags(): Array<{ tag: string; count: number }> | undefined {
  return [
    { tag: "promoter", count: 1 },
    { tag: "production", count: 1 },
    { tag: "san-diego", count: 1 },
  ];
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
}) => Promise<{ linkId: string }> {
  return async () => ({ linkId: "fixture-link" });
}

export function useUnlinkEvent(): (args: { linkId: string }) => Promise<null> {
  return async () => null;
}

export function primaryHandle(person: ContactListRow): string | null {
  return person.normalized_phones[0] ?? person.normalized_emails[0] ?? null;
}
