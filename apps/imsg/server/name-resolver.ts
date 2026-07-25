import type { ContactBook } from "./contacts";
import type { IdentityMirror } from "./identity-mirror";

/** The private CRM layer's shape, as carried by the Identity Mirror — see
 * shared/types.ts's ChatSummary.crm for the full field-by-field docs. */
export interface CrmData {
  is_favorite?: boolean;
  priority?: number;
  tags?: string[];
  events?: Array<{ id: string; name: string }>;
}

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
  /** A GROUP chat's own CRM (favorite/priority/tags/events), by chat guid —
   * undefined when the mirror has no data for this guid. Apple Contacts has
   * no concept of this, so ContactBook always returns undefined; only the
   * Identity Mirror (via NameResolver) has real data. See map.ts's mapChat
   * for the group/DM inheritance rule this feeds. */
  chatCrm(chatGuid: string): CrmData | undefined;
  /** The CRM of the person linked to this raw participant address —
   * undefined on a miss. This is how a DM's effective CRM is INHERITED from
   * its one participant's person (see map.ts's mapChat) rather than having a
   * second, independently-editable copy. */
  personCrm(address: string): CrmData | undefined;
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

  /** No ContactBook fallback — Apple Contacts has no CRM concept at all, so
   * there's nothing to fall back TO (unlike lookup/searchTerms, where
   * ContactBook fills a real freshness gap). */
  chatCrm(chatGuid: string): CrmData | undefined {
    return this.mirror.chatCrm(chatGuid);
  }

  personCrm(address: string): CrmData | undefined {
    return this.mirror.personCrm(address);
  }
}
