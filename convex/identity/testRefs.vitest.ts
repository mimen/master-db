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
  Array<{
    normalized: string;
    display_name: string;
    terms: string[];
    crm: {
      is_favorite?: boolean;
      priority?: number;
      tags: string[];
      events: Array<{ id: string; name: string; linkId: Id<"event_links"> }>;
    };
  }>
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

export const listTagsRef = makeFunctionReference<
  "query",
  { key: string },
  Array<{ tag: string; count: number }>
>("identity/queries:listTags");

export const setFavoriteRef = makeFunctionReference<
  "mutation",
  { key: string; personId: Id<"people">; is_favorite: boolean },
  null
>("identity/crm:setFavorite");

export const setPriorityRef = makeFunctionReference<
  "mutation",
  { key: string; personId: Id<"people">; priority?: number | null },
  null
>("identity/crm:setPriority");

export const addTagRef = makeFunctionReference<
  "mutation",
  { key: string; personId: Id<"people">; tag: string },
  null
>("identity/crm:addTag");

export const removeTagRef = makeFunctionReference<
  "mutation",
  { key: string; personId: Id<"people">; tag: string },
  null
>("identity/crm:removeTag");

export const setChatFavoriteRef = makeFunctionReference<
  "mutation",
  { key: string; chatGuid: string; is_favorite: boolean },
  null
>("identity/crm:setChatFavorite");

export const setChatPriorityRef = makeFunctionReference<
  "mutation",
  { key: string; chatGuid: string; priority?: number | null },
  null
>("identity/crm:setChatPriority");

export const addChatTagRef = makeFunctionReference<
  "mutation",
  { key: string; chatGuid: string; tag: string },
  null
>("identity/crm:addChatTag");

export const removeChatTagRef = makeFunctionReference<
  "mutation",
  { key: string; chatGuid: string; tag: string },
  null
>("identity/crm:removeChatTag");

export type ChatCrmProjection = {
  is_favorite?: boolean;
  priority?: number;
  tags: string[];
  events: Array<{ id: string; name: string; linkId: Id<"event_links"> }>;
};

export const chatCrmRef = makeFunctionReference<
  "query",
  { key: string; chatGuids?: string[] },
  Record<string, ChatCrmProjection>
>("identity/queries:chatCrm");

export const searchEventsRef = makeFunctionReference<
  "action",
  { key: string; query: string },
  Array<{ record_id: string; name: string; start_date?: string }>
>("identity/events:searchEvents");

export const linkEventRef = makeFunctionReference<
  "mutation",
  { key: string; personId?: Id<"people">; chatGuid?: string; airtable_event_id: string; event_name: string },
  { linkId: Id<"event_links"> }
>("identity/events:linkEvent");

export const unlinkEventRef = makeFunctionReference<
  "mutation",
  { key: string; linkId: Id<"event_links"> },
  null
>("identity/events:unlinkEvent");

export const migratePriorityToNumericRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { scanned: number; migrated: number; alreadyNumeric: number; unset: number; unrecognized: number }
>("identity/admin:migratePriorityToNumeric");

export const migratePersonTagsRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { scanned: number; migrated: number; alreadyPresent: number }
>("identity/admin:migratePersonTags");

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
