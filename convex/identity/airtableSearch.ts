import { v } from "convex/values";

import { action } from "../_generated/server";

import { aufIdentityQuery } from "./aufConvex";
import { canonicalDisplay, contactValues, readCanonicalSnapshot } from "./canonicalContacts";
import { requireIdentityAccess } from "./key";

/**
 * Live search of AUF's Humans (AUF `commaIdentity:searchHumans`), for imsg's Contacts screen:
 * "search our existing contacts first, Airtable matches below." Unlike
 * airtableSync.ts (background, link_only, only touches people Milad already
 * has), this surfaces people he DOESN'T have yet too — the whole point is
 * finding someone in the growing community database who isn't in the
 * identity graph, so he can add them on purpose (see mutations.ts's
 * addPersonFromAirtable).
 *
 * Not cached/ingested — searched live each call, which avoids storing data
 * for records nobody ever chose to add.
 */

type AufHuman = {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
};

export const searchAirtableHumans = action({
  args: { key: v.optional(v.string()), query: v.string() },
  handler: async (ctx, { key, query }) => {
    await requireIdentityAccess(ctx, key);
    const needle = query.trim();
    if (needle.length < 2) return [];

    const humans = await aufIdentityQuery<AufHuman[]>("searchHumans", { query: needle });
    const snapshot = await readCanonicalSnapshot(humans.map((row) => row.id));
    const canonical = snapshot.contacts;
    return humans
      .map((r) => ({
        record_id: snapshot.resolutions.find((row) => row.humanId === r.id)?.canonicalHumanId ?? r.id,
        display_name: r.name,
        first_name: r.firstName,
        last_name: r.lastName,
        phone: canonicalDisplay(r.primaryPhone, contactValues(canonical, r.id, "sms"), "sms"),
        email: canonicalDisplay(r.primaryEmail, contactValues(canonical, r.id, "email"), "email"),
        phones: contactValues(canonical, r.id, "sms"),
        emails: contactValues(canonical, r.id, "email"),
      }))
      .filter((r, index, rows) => r.display_name && (r.phones.length || r.emails.length) && rows.findIndex((other) => other.record_id === r.record_id) === index);
  },
});
