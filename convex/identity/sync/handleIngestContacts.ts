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
 * grouping matters and how it's used.
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

  const result = await ctx.runMutation(internal.identity.ingestContacts.ingestContactsBatch, {
    source: body.source,
    contacts: body.contacts,
  });

  return jsonResponse({ ok: true, ...result });
});

type ContactCardIn = {
  display_name?: string;
  img_url?: string;
  phones: string[];
  emails: string[];
};

type IngestBody = {
  source: string;
  contacts: ContactCardIn[];
};
