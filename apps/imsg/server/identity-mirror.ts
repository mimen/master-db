import { emailMatchKey, phoneMatchKey } from "../shared/address";
import type { Config } from "./config";

const REFRESH_MS = 5 * 60 * 1000;

interface NameDirectoryEntry {
  normalized: string;
  display_name: string;
  terms: string[];
}

/** One person's mirror record, keyed by phoneMatchKey/emailMatchKey. */
interface MirrorEntry {
  name: string;
  terms: string[];
}

/**
 * Convex's HTTP query envelope (POST {convexCloudUrl}/api/query):
 * https://docs.convex.dev/http-api/ — `{ status: "success", value }` on
 * success, `{ status: "error", errorMessage, errorData }` on failure.
 */
type ConvexQueryResponse =
  | { status: "success"; value: NameDirectoryEntry[] }
  | { status: "error"; errorMessage?: string; errorData?: unknown };

/**
 * Read replica of the Convex identity graph's `nameDirectory` — Convex is the
 * canonical name/identity source (manual in-app adds, renames, and
 * Airtable-linked people, in addition to whatever Apple Contacts fed it via
 * IdentitySync), but the chat-list hot path can't afford to block on a cloud
 * round-trip. This mirror keeps the whole directory in memory and refreshes
 * it on an interval; `lookup()` is a synchronous map read.
 *
 * No-ops (logs once, then stays silent) if CONVEX_CLOUD_URL or
 * IMSG_IDENTITY_KEY aren't configured — the mirror is optional, imsg must
 * keep working (falling back to ContactBook alone) without it.
 */
export class IdentityMirror {
  private timer: ReturnType<typeof setInterval> | null = null;
  private warned = false;
  private byKey = new Map<string, MirrorEntry>();

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

  /**
   * Every mirror person whose name-term set contains `query` (case-
   * insensitive substring) — a Convex-backed contact result. One result per
   * matched handle (address = the normalized match key), deduped by
   * address. Used by GET /api/contacts alongside ContactBook.search so a
   * rename/nickname/organization surfaces the person even when Apple
   * Contacts still has the old name.
   */
  search(query: string, limit: number): Array<{ address: string; name: string }> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const seen = new Set<string>();
    const results: Array<{ address: string; name: string }> = [];
    for (const [address, entry] of this.byKey) {
      if (results.length >= limit) break;
      if (seen.has(address)) continue;
      if (entry.terms.some((term) => term.includes(needle))) {
        seen.add(address);
        results.push({ address, name: entry.name });
      }
    }
    return results;
  }

  /**
   * Refreshes the in-memory map from Convex. Swallows and logs any failure,
   * keeping the last good snapshot rather than going blank on a transient
   * network error. No-op (returns immediately) when unconfigured.
   */
  async refresh(): Promise<void> {
    const { convexCloudUrl, identityKey } = this.config;
    if (!convexCloudUrl || !identityKey) return;

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
        console.error(`identity-mirror: query failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as ConvexQueryResponse;
      if (body.status !== "success") {
        console.error(`identity-mirror: query error: ${body.errorMessage ?? "unknown"}`);
        return;
      }
      const next = new Map<string, MirrorEntry>();
      for (const entry of body.value) {
        const emailKey = emailMatchKey(entry.normalized);
        const phoneKey = phoneMatchKey(entry.normalized);
        const value: MirrorEntry = { name: entry.display_name, terms: entry.terms ?? [] };
        if (emailKey) next.set(emailKey, value);
        else if (phoneKey) next.set(phoneKey, value);
      }
      this.byKey = next;
    } catch (err) {
      if (!this.warned) {
        console.error(`identity-mirror: ${err instanceof Error ? err.message : String(err)}`);
        this.warned = true;
      }
    }
  }
}
