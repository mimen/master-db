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
  normalized_phones: string[];
  normalized_emails: string[];
  airtable_human_id?: string;
};

export type AirtableHumanRow = {
  record_id: string;
  display_name: string;
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
  { handle: string; display_name?: string },
  { created: boolean; personId: string }
>("identity/mutations:createPerson");

const searchAirtableHumansRef = makeFunctionReference<"action", { query: string }, AirtableHumanRow[]>(
  "identity/airtableSearch:searchAirtableHumans",
);

const addPersonFromAirtableRef = makeFunctionReference<
  "mutation",
  { record_id: string; display_name?: string; phone?: string; email?: string },
  { personId: string }
>("identity/mutations:addPersonFromAirtable");

export function useWhoIs(handle: string | null): WhoIsResult | undefined {
  return useQuery(whoIsRef, handle ? { handle } : "skip");
}

export function useListPeople(): ContactListRow[] | undefined {
  return useQuery(listPeopleRef, {});
}

export function useCreatePerson() {
  return useMutation(createPersonRef);
}

export function useSearchAirtableHumans() {
  return useAction(searchAirtableHumansRef);
}

export function useAddPersonFromAirtable() {
  return useMutation(addPersonFromAirtableRef);
}

/** A person's first phone or email — enough to key the /person screen's whoIs lookup. */
export function primaryHandle(p: ContactListRow): string | null {
  return p.normalized_phones[0] ?? p.normalized_emails[0] ?? null;
}
