import { ConvexReactClient, useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { bootWebSocket } from "./boot-handoff";
import { requireConvexUrl } from "./public-env";

/**
 * imsg is not part of the master-db Convex build (Metro can't safely cross
 * the monorepo boundary to bundle convex/_generated — untested, and this
 * app already has real Metro/Expo-Go fragility per apps/imsg/AGENTS.md). Per the
 * original migration plan's own fallback, function refs are hand-typed
 * string paths instead of the generated `api` object. Keep these shapes in
 * sync with convex/identity/queries.ts and mutations.ts in the repo root.
 */

export const convexClient = new ConvexReactClient(
  requireConvexUrl(process.env.EXPO_PUBLIC_CONVEX_URL),
  { unsavedChangesWarning: false, webSocketConstructor: bootWebSocket() },
);


export type IdentityRow = {
  kind: string;
  network?: string;
  source: string;
  value: string;
  normalized: string;
  display_name?: string;
  chat_count: number;
  first_seen_at?: string;
};

/** P1–P5, ONE = HIGHEST PRIORITY — see convex/schema/identity/people.ts's
 * docstring. `undefined`/`null` means unset, deliberately distinct from any
 * numbered level. NOT inverted, unlike Todoist's API (see the root
 * AGENTS.md's Todoist Priority System gotcha) — the raw number IS the
 * P-level everywhere in this app. */
export type Priority = number;

/** A person's or GROUP chat's linked Airtable event — see
 * convex/schema/identity/event_links.ts. `linkId` is what unlinkEvent
 * expects (NOT `id`, which is the Airtable record id used for display/
 * dedupe). */
export type EventLink = { id: string; name: string; linkId: string; start_date?: string };

export type Person = {
  _id: string;
  display_name?: string;
  // Structured name parts (Phase 1 structured names) — aggregated from the
  // person's single "primary name identity" by recomputePersonAggregates,
  // or set directly by a manual edit. See convex/schema/identity/people.ts.
  first_name?: string;
  last_name?: string;
  nickname?: string;
  // Convex-native — no source (Apple/Airtable) has an organization field;
  // only a manual edit here ever sets it.
  organization?: string;
  // Private CRM layer (favorites/priority/tags/events) — app-native, exists
  // only inside imsg, never written to Apple or Airtable. See
  // convex/identity/crm.ts, convex/identity/events.ts, and
  // convex/schema/identity/{tags,event_links}.ts.
  is_favorite?: boolean;
  priority?: Priority;
  normalized_phones: string[];
  normalized_emails: string[];
  identity_count: number;
  message_count: number;
  is_self: boolean;
  airtable_human_id?: string;
  vault_entity?: string;
  notes?: string;
  notes_updated_at?: string;
  /** The normalized handle Comma reaches this person on first; absent means the first phone, then email. */
  primary_handle?: string;
  created_at?: string;
};

export type WhoIsResult =
  | {
      found: true;
      normalized: string;
      person: Person;
      tags: string[];
      events: EventLink[];
      identities: IdentityRow[];
    }
  | { found: false; normalized: string };

export type ContactListRow = {
  _id: string;
  display_name: string;
  /** listPeople resolves it; absent where a source does not. */
  photoUrl?: string | null;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  organization?: string;
  is_favorite?: boolean;
  priority?: Priority;
  tags?: string[];
  events?: EventLink[];
  normalized_phones: string[];
  normalized_emails: string[];
  airtable_human_id?: string;
  message_count?: number;
  primary_handle?: string;
  /** People the owner said are not the same person as this one. */
  not_duplicate_of?: string[];
  created_at?: string;
};

/** A GROUP chat's private CRM projection — the chat-side twin of the fields
 * carried on `Person`. Fetched live from Convex (identity/queries:chatCrm),
 * NOT through the imsg server's REST chat list — that's what makes editing
 * (favorite/priority/tag/event-link) reactive without waiting on the
 * server's cache TTL. See convex/schema/identity/chat_crm.ts. */
export type ChatCrm = {
  is_favorite?: boolean;
  priority?: Priority;
  tags: string[];
  events: EventLink[];
};

export type AirtableEventRow = { record_id: string; name: string; start_date?: string };

export type AirtableHumanRow = {
  record_id: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
};

const whoIsRef = makeFunctionReference<"query", { handle: string }, WhoIsResult>(
  "identity/queries:whoIs",
);

const listPeopleRef = makeFunctionReference<"query", Record<string, never>, ContactListRow[]>(
  "identity/queries:listPeople",
);

const createPersonRef = makeFunctionReference<
  "mutation",
  {
    handle: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    organization?: string;
  },
  { created: boolean; personId: string }
>("identity/mutations:createPerson");

const searchAirtableHumansRef = makeFunctionReference<
  "action",
  { query: string },
  AirtableHumanRow[]
>("identity/airtableSearch:searchAirtableHumans");

const addPersonFromAirtableRef = makeFunctionReference<
  "mutation",
  {
    record_id: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
  },
  { personId: string }
>("identity/mutations:addPersonFromAirtable");

const renamePersonRef = makeFunctionReference<
  "mutation",
  {
    personId: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    organization?: string;
  },
  null
>("identity/mutations:renamePerson");

// Private CRM layer (convex/identity/crm.ts) — favorites, priority, tags.
// Convex-native, never synced to Apple/Airtable.

const setFavoriteRef = makeFunctionReference<
  "mutation",
  { personId: string; is_favorite: boolean },
  null
>("identity/crm:setFavorite");

const setPriorityRef = makeFunctionReference<
  "mutation",
  { personId: string; priority?: Priority | null },
  null
>("identity/crm:setPriority");

const addTagRef = makeFunctionReference<
  "mutation",
  { personId: string; tag: string },
  null
>("identity/crm:addTag");

const removeTagRef = makeFunctionReference<
  "mutation",
  { personId: string; tag: string },
  null
>("identity/crm:removeTag");

const listTagsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  Array<{ tag: string; count: number }>
>("identity/queries:listTags");

// Chat-side CRM (convex/identity/crm.ts) — the chat-targeted twins of the
// person mutations above. GROUP chats only by convention (see
// chat-crm-section.tsx); Convex itself doesn't enforce that.

const setChatFavoriteRef = makeFunctionReference<
  "mutation",
  { chatGuid: string; is_favorite: boolean },
  null
>("identity/crm:setChatFavorite");

const setChatPriorityRef = makeFunctionReference<
  "mutation",
  { chatGuid: string; priority?: Priority | null },
  null
>("identity/crm:setChatPriority");

const addChatTagRef = makeFunctionReference<
  "mutation",
  { chatGuid: string; tag: string },
  null
>("identity/crm:addChatTag");

const removeChatTagRef = makeFunctionReference<
  "mutation",
  { chatGuid: string; tag: string },
  null
>("identity/crm:removeChatTag");

const chatCrmRef = makeFunctionReference<
  "query",
  { chatGuids?: string[] },
  Record<string, ChatCrm>
>("identity/queries:chatCrm");

// Event/project association (convex/identity/events.ts) — a typed link to an
// Airtable Events record, available on both people and GROUP chats.

const searchEventsRef = makeFunctionReference<
  "action",
  { query: string },
  AirtableEventRow[]
>("identity/events:searchEvents");

const linkEventRef = makeFunctionReference<
  "mutation",
  { personId?: string; chatGuid?: string; airtable_event_id: string; event_name: string; start_date?: string },
  { linkId: string }
>("identity/events:linkEvent");

const setNotesRef = makeFunctionReference<"mutation", { personId: string; notes: string }, null>(
  "identity/crm:setNotes",
);

const setPrimaryHandleRef = makeFunctionReference<"mutation", { personId: string; handle: string }, null>(
  "identity/mutations:setPrimaryHandle",
);

const addHandleRef = makeFunctionReference<"mutation", { personId: string; handle: string }, null>(
  "identity/mutations:addHandle",
);

const mergePeopleRef = makeFunctionReference<"mutation", { keepId: string; mergeId: string }, null>(
  "identity/mutations:mergePeople",
);

const markNotDuplicateRef = makeFunctionReference<"mutation", { personId: string; otherId: string }, null>(
  "identity/mutations:markNotDuplicate",
);

const unlinkEventRef = makeFunctionReference<"mutation", { linkId: string }, null>(
  "identity/events:unlinkEvent",
);

export function useWhoIs(handle: string | null): WhoIsResult | undefined {
  return useQuery(whoIsRef, handle ? { handle } : "skip");
}

export function useListPeople(): ContactListRow[] | undefined {
  return useQuery(listPeopleRef, {});
}

export function useCreatePerson() {
  const mutate = useMutation(createPersonRef);
  return (args: {
    handle: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    organization?: string;
  }) => mutate(args);
}

export function useSearchAirtableHumans() {
  const run = useAction(searchAirtableHumansRef);
  return (args: { query: string }) => run(args);
}

export function useAddPersonFromAirtable() {
  const mutate = useMutation(addPersonFromAirtableRef);
  return (args: {
    record_id: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
  }) => mutate(args);
}

export function useRenamePerson() {
  const mutate = useMutation(renamePersonRef);
  return (args: {
    personId: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    organization?: string;
  }) => mutate(args);
}

export function useSetFavorite() {
  const mutate = useMutation(setFavoriteRef);
  return (args: { personId: string; is_favorite: boolean }) => mutate(args);
}

export function useSetPriority() {
  const mutate = useMutation(setPriorityRef);
  return (args: { personId: string; priority?: Priority | null }) => mutate(args);
}

export function useAddTag() {
  const mutate = useMutation(addTagRef);
  return (args: { personId: string; tag: string }) => mutate(args);
}

export function useRemoveTag() {
  const mutate = useMutation(removeTagRef);
  return (args: { personId: string; tag: string }) => mutate(args);
}

export function useListTags(): Array<{ tag: string; count: number }> | undefined {
  return useQuery(listTagsRef, {});
}

/** A GROUP chat's live CRM projection — undefined while loading, `{tags:[],
 * events:[]}` (no is_favorite/priority) when the chat has never been
 * annotated. `null`/omitted chatGuid skips the query (mirrors useWhoIs). */
export function useChatCrm(chatGuid: string | null): ChatCrm | undefined {
  const result = useQuery(chatCrmRef, chatGuid ? { chatGuids: [chatGuid] } : "skip");
  if (!chatGuid) return undefined;
  return result?.[chatGuid] ?? (result ? { tags: [], events: [] } : undefined);
}

export function useSetChatFavorite() {
  const mutate = useMutation(setChatFavoriteRef);
  return (args: { chatGuid: string; is_favorite: boolean }) => mutate(args);
}

export function useSetChatPriority() {
  const mutate = useMutation(setChatPriorityRef);
  return (args: { chatGuid: string; priority?: Priority | null }) => mutate(args);
}

export function useAddChatTag() {
  const mutate = useMutation(addChatTagRef);
  return (args: { chatGuid: string; tag: string }) => mutate(args);
}

export function useRemoveChatTag() {
  const mutate = useMutation(removeChatTagRef);
  return (args: { chatGuid: string; tag: string }) => mutate(args);
}

export function useSearchEvents() {
  const run = useAction(searchEventsRef);
  return (args: { query: string }) => run(args);
}

export function useLinkEvent() {
  const mutate = useMutation(linkEventRef);
  return (args: { personId?: string; chatGuid?: string; airtable_event_id: string; event_name: string; start_date?: string }) =>
    mutate(args);
}

export function useSetNotes() {
  const mutate = useMutation(setNotesRef);
  return (args: { personId: string; notes: string }) => mutate(args);
}

export function useSetPrimaryHandle() {
  const mutate = useMutation(setPrimaryHandleRef);
  return (args: { personId: string; handle: string }) => mutate(args);
}

export function useAddHandle() {
  const mutate = useMutation(addHandleRef);
  return (args: { personId: string; handle: string }) => mutate(args);
}

export function useMergePeople() {
  const mutate = useMutation(mergePeopleRef);
  return (args: { keepId: string; mergeId: string }) => mutate(args);
}

export function useMarkNotDuplicate() {
  const mutate = useMutation(markNotDuplicateRef);
  return (args: { personId: string; otherId: string }) => mutate(args);
}

export function useUnlinkEvent() {
  const mutate = useMutation(unlinkEventRef);
  return (args: { linkId: string }) => mutate(args);
}

/** The handle Comma reaches a person on first: their chosen primary, else the first phone, then email. */
export function primaryHandle(p: Pick<ContactListRow, "normalized_phones" | "normalized_emails" | "primary_handle">): string | null {
  return p.primary_handle ?? p.normalized_phones[0] ?? p.normalized_emails[0] ?? null;
}
