import { ConvexReactClient, useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

/**
 * imsg is not part of the master-db Convex build (Metro can't safely cross
 * the monorepo boundary to bundle convex/_generated — untested, and this
 * app already has real Metro/Expo-Go fragility per CLAUDE.md). Per the
 * original migration plan's own fallback, function refs are hand-typed
 * string paths instead of the generated `api` object. Keep these shapes in
 * sync with convex/identity/queries.ts and mutations.ts in the repo root.
 */

export const convexClient = new ConvexReactClient(
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "",
  { unsavedChangesWarning: false },
);

/**
 * Shared-key auth for the identity module (convex/identity/key.ts):
 * the Convex deployment URL ships in this JS bundle, so every public
 * identity function requires this key on every call. Read once at module
 * load; every hook below injects it so no call-site elsewhere in the client
 * needs to know it exists.
 */
const IDENTITY_KEY = process.env.EXPO_PUBLIC_IMSG_IDENTITY_KEY ?? "";

export type IdentityRow = {
  kind: string;
  network?: string;
  source: string;
  value: string;
  normalized: string;
  display_name?: string;
  chat_count: number;
};

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
  normalized_phones: string[];
  normalized_emails: string[];
  identity_count: number;
  message_count: number;
  is_self: boolean;
  airtable_human_id?: string;
  vault_entity?: string;
};

export type WhoIsResult =
  | { found: true; normalized: string; person: Person; identities: IdentityRow[] }
  | { found: false; normalized: string };

export type ContactListRow = {
  _id: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  organization?: string;
  normalized_phones: string[];
  normalized_emails: string[];
  airtable_human_id?: string;
};

export type AirtableHumanRow = {
  record_id: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
};

const whoIsRef = makeFunctionReference<"query", { key: string; handle: string }, WhoIsResult>(
  "identity/queries:whoIs",
);

const listPeopleRef = makeFunctionReference<"query", { key: string }, ContactListRow[]>(
  "identity/queries:listPeople",
);

const createPersonRef = makeFunctionReference<
  "mutation",
  {
    key: string;
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
  { key: string; query: string },
  AirtableHumanRow[]
>("identity/airtableSearch:searchAirtableHumans");

const addPersonFromAirtableRef = makeFunctionReference<
  "mutation",
  {
    key: string;
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
    key: string;
    personId: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    organization?: string;
  },
  null
>("identity/mutations:renamePerson");

export function useWhoIs(handle: string | null): WhoIsResult | undefined {
  return useQuery(whoIsRef, handle ? { key: IDENTITY_KEY, handle } : "skip");
}

export function useListPeople(): ContactListRow[] | undefined {
  return useQuery(listPeopleRef, { key: IDENTITY_KEY });
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
  }) => mutate({ key: IDENTITY_KEY, ...args });
}

export function useSearchAirtableHumans() {
  const run = useAction(searchAirtableHumansRef);
  return (args: { query: string }) => run({ key: IDENTITY_KEY, ...args });
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
  }) => mutate({ key: IDENTITY_KEY, ...args });
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
  }) => mutate({ key: IDENTITY_KEY, ...args });
}

/** A person's first phone or email — enough to key the /person screen's whoIs lookup. */
export function primaryHandle(p: ContactListRow): string | null {
  return p.normalized_phones[0] ?? p.normalized_emails[0] ?? null;
}
