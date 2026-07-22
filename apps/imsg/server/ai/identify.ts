import type { IdentityCandidate } from "./prompts";

/**
 * Candidate retrieval for contact inference.
 *
 * Deliberately deterministic and server-side (D6): looking up a phone number is
 * a search, not a judgement call, so the model never gets tools for it. We find
 * the hits; the model only decides which one the conversation corroborates.
 */

/**
 * Phone numbers are written a dozen ways across notes — +1 (415) 555-0000,
 * 415.555.0000, 4155550000. Matching on the last 10 digits collapses all of
 * them without dragging in a phone-parsing dependency.
 */
export function digitsKey(address: string): string | null {
  const digits = address.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** Builds a regex matching a number regardless of separators between digits. */
export function loosePhonePattern(key: string): string {
  return key.split("").join("[^0-9]{0,2}");
}

export interface VaultSearchDeps {
  /** Injected so tests never shell out. Returns matching file paths + lines. */
  search: (pattern: string) => Promise<Array<{ path: string; line: string }>>;
}

/**
 * Searches the vault for a phone number and turns each hit into a candidate
 * named after the note that contains it — vault notes are named for their
 * subject, so the filename is the strongest identity signal available.
 */
export async function vaultCandidates(
  address: string,
  deps: VaultSearchDeps,
): Promise<IdentityCandidate[]> {
  const key = digitsKey(address);
  if (!key) return [];

  const hits = await deps.search(loosePhonePattern(key));
  const seen = new Set<string>();
  const candidates: IdentityCandidate[] = [];

  for (const hit of hits) {
    const name = noteName(hit.path);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    candidates.push({
      source: "vault",
      name,
      detail: `number appears in ${shortPath(hit.path)}`,
    });
    if (candidates.length >= 3) break;
  }
  return candidates;
}

function noteName(path: string): string | null {
  const base = path.split("/").pop();
  if (!base) return null;
  return base.replace(/\.md$/i, "").trim() || null;
}

function shortPath(path: string): string {
  const parts = path.split("/");
  return parts.slice(-2).join("/");
}

/** Contact-book hit, when BlueBubbles already knows the name. */
export function contactCandidate(name: string | null): IdentityCandidate[] {
  if (!name) return [];
  return [{ source: "contacts", name, detail: "already in the macOS address book" }];
}

/** Merges sources, preferring earlier ones, and caps what reaches the prompt. */
export function mergeCandidates(
  groups: IdentityCandidate[][],
  limit = 5,
): IdentityCandidate[] {
  const seen = new Set<string>();
  const merged: IdentityCandidate[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const key = candidate.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}
