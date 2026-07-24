// Named `.vitest.ts` (not `.ts`), matching test-utils.vitest.ts's convention,
// so the Convex bundler skips this file.
//
// Hand-typed function references for the identity module's convex-test
// suites. Not routed through the generated `api`/`internal` objects because
// codegen isn't run as part of this workflow (see convex/README.md /
// CLAUDE.md) — a stale or absent `_generated/api.js` would make every
// `api.identity.*` reference fail even though the underlying functions are
// fine. convex-test dispatches by module path against the real source
// modules passed to `convexTest(schema, modules)`, so a hand-typed
// `FunctionReference` (same technique apps/imsg/client/src/lib/identity.ts
// uses for the same reason) resolves correctly regardless of codegen state.
import { makeFunctionReference } from "convex/server";

import type { Id } from "../_generated/dataModel";

export const whoIsRef = makeFunctionReference<
  "query",
  { key: string; handle: string },
  unknown
>("identity/queries:whoIs");

export const searchPeopleRef = makeFunctionReference<
  "query",
  { key: string; name: string },
  unknown
>("identity/queries:searchPeople");

export const listPeopleRef = makeFunctionReference<
  "query",
  { key: string },
  unknown
>("identity/queries:listPeople");

export const topLinkedPeopleRef = makeFunctionReference<
  "query",
  { key: string; limit?: number },
  unknown
>("identity/queries:topLinkedPeople");

export const nameDirectoryRef = makeFunctionReference<
  "query",
  { key: string },
  Array<{ normalized: string; display_name: string; terms: string[] }>
>("identity/queries:nameDirectory");

export const createPersonRef = makeFunctionReference<
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
  { created: boolean; personId: Id<"people"> }
>("identity/mutations:createPerson");

export const addPersonFromAirtableRef = makeFunctionReference<
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
  { personId: Id<"people"> }
>("identity/mutations:addPersonFromAirtable");

export const renamePersonRef = makeFunctionReference<
  "mutation",
  {
    key: string;
    personId: Id<"people">;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    organization?: string;
  },
  null
>("identity/mutations:renamePerson");

export const searchAirtableHumansRef = makeFunctionReference<
  "action",
  { key: string; query: string },
  unknown
>("identity/airtableSearch:searchAirtableHumans");

export const ingestContactsBatchRef = makeFunctionReference<
  "mutation",
  {
    source: string;
    contacts: Array<{
      display_name?: string;
      first_name?: string;
      last_name?: string;
      nickname?: string;
      source_contact_id?: string;
      phones: string[];
      emails: string[];
      airtable_record_id?: string;
    }>;
    link_only?: boolean;
  },
  unknown
>("identity/ingestContacts:ingestContactsBatch");

export const TEST_KEY = "test-identity-key";
