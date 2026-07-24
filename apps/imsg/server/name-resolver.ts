import type { ContactBook } from "./contacts";
import type { IdentityMirror } from "./identity-mirror";

/**
 * The minimal shape map.ts's name-resolution call sites need — satisfied by
 * both a raw ContactBook and a NameResolver, so callers that only resolve
 * names don't care which they were handed.
 */
export interface NameSource {
  lookup(address: string): string | null;
  /**
   * The matched person's full searchable name-term set (display, first,
   * last, nickname, organization…) — [] on a miss. Used by map.ts to
   * populate ChatSummary.searchNames so a conversation is findable by ANY
   * of a person's names, not just their current display name.
   */
  searchTerms(address: string): string[];
  readonly available: boolean;
}

/**
 * Combines the Convex Identity Mirror and Apple's ContactBook into the one
 * name source the Chat Directory resolves participant names through: mirror
 * first, ContactBook fallback. The mirror is a superset — Apple names flow
 * into Convex via IdentitySync, plus manual in-app renames/adds, which must
 * WIN over a stale Apple name — while ContactBook only covers the freshness
 * gap of a contact added to Apple Contacts within the last IdentitySync
 * cycle. `known` (in map.ts's mapChat) derives from this same resolution: a
 * name from either source counts as known.
 *
 * `available` deliberately mirrors ContactBook.available ONLY. The Identity
 * Mirror being unavailable/unconfigured must degrade silently to today's
 * ContactBook-only behavior — never to "everything unknown." (The mirror
 * itself already fails safe by keeping its last good snapshot on a refresh
 * error, but even a cold/never-started mirror must not affect this flag.)
 */
export class NameResolver implements NameSource {
  constructor(
    private mirror: IdentityMirror,
    private contactBook: ContactBook,
  ) {}

  get available(): boolean {
    return this.contactBook.available;
  }

  lookup(address: string): string | null {
    return this.mirror.lookup(address) ?? this.contactBook.lookup(address);
  }

  /**
   * The mirror's full Convex term set (nickname, renamed, org, first/last)
   * when it has the person; otherwise falls back to ContactBook's single
   * resolved name, matching the same mirror-first/ContactBook-fallback
   * precedence as lookup().
   */
  searchTerms(address: string): string[] {
    const mirrorTerms = this.mirror.searchTerms(address);
    if (mirrorTerms.length > 0) return mirrorTerms;
    return this.contactBook.searchTerms(address);
  }
}
