import { emailMatchKey, phoneMatchKey } from "../shared/address";
import type { Config } from "./config";
import type { CrmData } from "./name-resolver";

const REFRESH_MS = 5 * 60 * 1000;

interface NameDirectoryEntry {
  normalized: string;
  display_name: string;
  terms: string[];
  crm: CrmData;
}

/** One person's mirror record, keyed by phoneMatchKey/emailMatchKey. */
interface MirrorEntry {
  name: string;
  terms: string[];
  crm: CrmData;
}

/**
 * Convex's HTTP query envelope (POST {convexCloudUrl}/api/query):
 * https://docs.convex.dev/http-api/ — `{ status: "success", value }` on
 * success, `{ status: "error", errorMessage, errorData }` on failure.
 */
type ConvexQueryResponse<T> =
  | { status: "success"; value: T }
  | { status: "error"; errorMessage?: string; errorData?: unknown };

/**
 * Read replica of the Convex identity graph's `nameDirectory` (people) AND
 * `chatCrm` (GROUP chats) — Convex is the canonical name/identity AND CRM
 * source (manual in-app adds, renames, favorites/priority/tags/event links),
 * but the chat-list hot path can't afford to block on a cloud round-trip.
 * This mirror keeps both in memory and refreshes them on an interval;
 * `lookup()`/`chatCrm()`/`personCrm()` are all synchronous map reads.
 *
 * No-ops (logs once per source, then stays silent) if CONVEX_CLOUD_URL or
 * IMSG_IDENTITY_KEY aren't configured — the mirror is optional, imsg must
 * keep working (falling back to ContactBook alone, and no CRM at all) without
 * it. Same fail-open contract for chat CRM as for names: mirror down or
 * unconfigured ⇒ no CRM shown, never an error.
 */
export class IdentityMirror {
  private timer: ReturnType<typeof setInterval> | null = null;
  private warnedNames = false;
  private warnedChatCrm = false;
  private byKey = new Map<string, MirrorEntry>();
  private chatCrmByGuid = new Map<string, CrmData>();

  constructor(private config: Pick<Config, "convexCloudUrl" | "identityKey">) {}

  start(): void {
    if (!this.config.convexCloudUrl || !this.config.identityKey) {
      console.log("identity-mirror: CONVEX_CLOUD_URL/IMSG_IDENTITY_KEY not set, skipping");
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Resolves a RAW address (whatever shape BlueBubbles or the client hands
   * back) to its mirror entry, via the same phone/email match-key seam
   * ContactBook and the client's person-view use — see shared/address.ts.
   * Returns null on a miss; never throws.
   */
  private entry(address: string): MirrorEntry | null {
    const emailKey = emailMatchKey(address);
    if (emailKey) {
      const hit = this.byKey.get(emailKey);
      if (hit) return hit;
    }
    const phoneKey = phoneMatchKey(address);
    if (phoneKey) {
      const hit = this.byKey.get(phoneKey);
      if (hit) return hit;
    }
    return null;
  }

  /** Resolves a RAW participant address to a display name. Null on a miss. */
  lookup(address: string): string | null {
    return this.entry(address)?.name ?? null;
  }

  /**
   * The matched person's FULL searchable name-term set (display, first,
   * last, nickname, organization, "first last") — [] on a miss. This is what
   * lets a conversation surface by an old/nick/organization name, not just
   * the current display_name (see map.ts's ChatSummary.searchNames).
   */
  searchTerms(address: string): string[] {
    return this.entry(address)?.terms ?? [];
  }

  /** The CRM of the person linked to this raw participant address — how a
   * DM's ChatSummary.crm is INHERITED (see map.ts's mapChat). undefined on a
   * miss (address not resolved by the mirror at all — distinct from a
   * resolved person who simply has no CRM data, which map.ts's normalization
   * also collapses to undefined on the wire). */
  personCrm(address: string): CrmData | undefined {
    return this.entry(address)?.crm;
  }

  /** A GROUP chat's own CRM, by chat guid — undefined when the mirror has no
   * data for this guid (never favorited/prioritized/tagged/linked). */
  chatCrm(chatGuid: string): CrmData | undefined {
    return this.chatCrmByGuid.get(chatGuid);
  }

  /**
   * Every mirror person whose name-term set contains `query` (case-
   * insensitive substring) — a Convex-backed contact result. One result per
   * matched handle (address = the normalized match key), deduped by
   * address. Used by GET /api/contacts alongside ContactBook.search so a
   * rename/nickname/organization surfaces the person even when Apple
   * Contacts still has the old name. `is_favorite` rides along from the
   * same CRM data personCrm()/chatCrm() read — lets the ⌘K palette rank a
   * favorited person's contact result first (see client/lib/palette/model.ts).
   */
  search(query: string, limit: number): Array<{ address: string; name: string; is_favorite?: boolean }> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const seen = new Set<string>();
    const results: Array<{ address: string; name: string; is_favorite?: boolean }> = [];
    for (const [address, entry] of this.byKey) {
      if (results.length >= limit) break;
      if (seen.has(address)) continue;
      if (entry.terms.some((term) => term.includes(needle))) {
        seen.add(address);
        results.push({ address, name: entry.name, is_favorite: entry.crm.is_favorite });
      }
    }
    return results;
  }

  /**
   * Refreshes both in-memory maps from Convex (names+person-CRM, and chat
   * CRM) — independently, so a failure in one doesn't blank out the other.
   * No-op (returns immediately) when unconfigured.
   */
  async refresh(): Promise<void> {
    const { convexCloudUrl, identityKey } = this.config;
    if (!convexCloudUrl || !identityKey) return;

    await Promise.all([
      this.refreshNameDirectory(convexCloudUrl, identityKey),
      this.refreshChatCrm(convexCloudUrl, identityKey),
    ]);
  }

  /**
   * Fetches `identity/queries:nameDirectory`. Swallows and logs any failure
   * (once), keeping the last good snapshot rather than going blank on a
   * transient network error.
   */
  private async refreshNameDirectory(convexCloudUrl: string, identityKey: string): Promise<void> {
    try {
      const res = await fetch(`${convexCloudUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "identity/queries:nameDirectory",
          args: { key: identityKey },
          format: "json",
        }),
      });
      if (!res.ok) {
        console.error(`identity-mirror: nameDirectory query failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as ConvexQueryResponse<NameDirectoryEntry[]>;
      if (body.status !== "success") {
        console.error(`identity-mirror: nameDirectory query error: ${body.errorMessage ?? "unknown"}`);
        return;
      }
      const next = new Map<string, MirrorEntry>();
      for (const entry of body.value) {
        const emailKey = emailMatchKey(entry.normalized);
        const phoneKey = phoneMatchKey(entry.normalized);
        const value: MirrorEntry = { name: entry.display_name, terms: entry.terms ?? [], crm: entry.crm ?? {} };
        if (emailKey) next.set(emailKey, value);
        else if (phoneKey) next.set(phoneKey, value);
      }
      this.byKey = next;
    } catch (err) {
      if (!this.warnedNames) {
        console.error(`identity-mirror: ${err instanceof Error ? err.message : String(err)}`);
        this.warnedNames = true;
      }
    }
  }

  /**
   * Fetches `identity/queries:chatCrm` with NO chatGuids filter — the mirror
   * has no independent way to know which chat guids currently exist (that's
   * BlueBubbles/ChatDirectory's domain, not Convex's), so it asks for
   * "everything with any CRM data," which is naturally small (only chats
   * someone actually favorited/prioritized/tagged/linked get a row at all).
   * Same swallow-log-once-keep-last-snapshot failure handling as names.
   */
  private async refreshChatCrm(convexCloudUrl: string, identityKey: string): Promise<void> {
    try {
      const res = await fetch(`${convexCloudUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "identity/queries:chatCrm",
          args: { key: identityKey },
          format: "json",
        }),
      });
      if (!res.ok) {
        console.error(`identity-mirror: chatCrm query failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as ConvexQueryResponse<Record<string, CrmData>>;
      if (body.status !== "success") {
        console.error(`identity-mirror: chatCrm query error: ${body.errorMessage ?? "unknown"}`);
        return;
      }
      this.chatCrmByGuid = new Map(Object.entries(body.value));
    } catch (err) {
      if (!this.warnedChatCrm) {
        console.error(`identity-mirror: ${err instanceof Error ? err.message : String(err)}`);
        this.warnedChatCrm = true;
      }
    }
  }
}
