import type { BBContact } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import type { Config } from "./config";

const REFRESH_MS = 10 * 60 * 1000; // piggybacks ContactBook's own refresh cadence

/**
 * Pushes Apple Contacts to the identity graph in master-db, so imsg's person
 * view can resolve "who is this handle" beyond what BlueBubbles' contact
 * cache already gives the ChatDirectory. Each BlueBubbles contact card is
 * sent pre-grouped (all its phones/emails together) — see
 * convex/identity/ingestContacts.ts in the monorepo root for why that
 * grouping is load-bearing.
 *
 * No-ops (logs once, then stays silent) if CONVEX_SITE_URL or
 * APPLE_CONTACTS_INGEST_SECRET aren't configured — contact sync is optional,
 * imsg must keep working without it.
 */
export class IdentitySync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private warned = false;

  constructor(
    private client: BlueBubbles,
    private config: Pick<Config, "convexSiteUrl" | "appleContactsIngestSecret">,
    /** Fired after a successful push, so the Identity Mirror can shorten its
     * lag on Apple-side changes instead of waiting for its own 5-minute tick. */
    private onSynced?: () => void,
  ) {}

  start(): void {
    if (!this.config.convexSiteUrl || !this.config.appleContactsIngestSecret) {
      console.log("identity-sync: CONVEX_SITE_URL/APPLE_CONTACTS_INGEST_SECRET not set, skipping");
      return;
    }
    void this.syncOnce();
    this.timer = setInterval(() => void this.syncOnce(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async syncOnce(): Promise<{ ok: boolean; peopleCreated?: number; peopleReused?: number } | null> {
    const { convexSiteUrl, appleContactsIngestSecret } = this.config;
    if (!convexSiteUrl || !appleContactsIngestSecret) return null;

    const result = await this.client.contacts();
    if (!result.ok) {
      console.error(`identity-sync: failed to fetch contacts: ${result.error}`);
      return null;
    }

    const contacts = result.value.map(toContactCard).filter((c) => c.phones.length > 0 || c.emails.length > 0);
    if (contacts.length === 0) return { ok: true, peopleCreated: 0, peopleReused: 0 };

    try {
      const res = await fetch(`${convexSiteUrl}/identity/ingest-contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${appleContactsIngestSecret}`,
        },
        body: JSON.stringify({ source: "apple_contact", contacts }),
      });
      if (!res.ok) {
        console.error(`identity-sync: ingest failed with status ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { peopleCreated: number; peopleReused: number };
      console.log(
        `identity-sync: synced ${contacts.length} contacts (${body.peopleCreated} new, ${body.peopleReused} reused)`,
      );
      this.onSynced?.();
      return { ok: true, ...body };
    } catch (err) {
      if (!this.warned) {
        console.error(`identity-sync: ${err instanceof Error ? err.message : String(err)}`);
        this.warned = true;
      }
      return null;
    }
  }
}

/**
 * Deliberately drops `avatar` — it's raw base64 image bytes, not a URL, and
 * a single contact photo can alone exceed Convex's 1MiB per-document cap
 * (hit in practice against a real 1518-contact export). The imsg client
 * already renders photos via its own /api/avatars/:address route, which
 * reads the same AddressBook export this app has always used — nothing
 * downstream reads a photo out of the identity graph, so there's nothing to
 * lose by not duplicating it there.
 */
export function toContactCard(c: BBContact): {
  display_name?: string;
  phones: string[];
  emails: string[];
} {
  const assembled = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const displayName = c.displayName?.trim() || c.nickname?.trim() || assembled || undefined;
  return {
    display_name: displayName,
    phones: (c.phoneNumbers ?? []).map((p) => p.address).filter(Boolean),
    emails: (c.emails ?? []).map((e) => e.address).filter(Boolean),
  };
}
