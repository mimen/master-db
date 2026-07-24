import { internal } from "../../_generated/api";
import { httpAction } from "../../_generated/server";

import { checkContactsIngestAuth, jsonResponse } from "./auth";

/**
 * Ingest endpoint for imsg's Apple Contacts sync job.
 *
 * Path:    POST /identity/ingest-contacts
 * Headers: Authorization: Bearer <APPLE_CONTACTS_INGEST_SECRET>
 * Body:    { "source": "apple_contact", "contacts": ContactCardIn[] }
 *
 * Each ContactCardIn is one Apple Contacts card (imsg's BBContact), with all
 * of its phones/emails grouped together — see ingestContacts.ts for why that
 * grouping matters and how it's used. first_name/last_name/nickname/
 * source_contact_id are the structured parts (Phase 1 structured names);
 * optional so an older imsg build that hasn't shipped them yet still works.
 *
 * Response: { ok: true, peopleCreated, peopleReused, identitiesWritten, skippedNoHandles }
 */
export const handleIngestContacts = httpAction(async (ctx, req) => {
  const authErr = checkContactsIngestAuth(req);
  if (authErr) return authErr;

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (!body.source || !Array.isArray(body.contacts)) {
    return jsonResponse({ ok: false, error: "expected { source, contacts }" }, 400);
  }

  // Convex caps total mutation args at 1 MiB — a full Apple Contacts export
  // (1000+ cards) blows past that in one call. Sub-batch, same as Beeper's
  // handleIngest.ts does for messages.
  const totals = { peopleCreated: 0, peopleReused: 0, identitiesWritten: 0, skippedNoHandles: 0 };
  for (let i = 0; i < body.contacts.length; i += 50) {
    const slice = body.contacts.slice(i, i + 50);
    const result = await ctx.runMutation(internal.identity.ingestContacts.ingestContactsBatch, {
      source: body.source,
      contacts: slice,
    });
    totals.peopleCreated += result.peopleCreated;
    totals.peopleReused += result.peopleReused;
    totals.identitiesWritten += result.identitiesWritten;
    totals.skippedNoHandles += result.skippedNoHandles;
  }

  return jsonResponse({ ok: true, ...totals });
});

type ContactCardIn = {
  display_name?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  source_contact_id?: string;
  img_url?: string;
  phones: string[];
  emails: string[];
};

type IngestBody = {
  source: string;
  contacts: ContactCardIn[];
};
