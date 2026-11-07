/** The name fields of a `people` row. Plain, so imsg's fixture can import it without the generated data model. */
export interface NamedPerson {
  display_name?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  organization?: string;
}

/** A person's name in the identity graph, or null when the graph has none for them. */
export function personName(person: NamedPerson | null | undefined): string | null {
  return person?.display_name || null;
}

/**
 * A person's full searchable name-term set: display name, structured parts,
 * organization, and the combined "first last", deduped and lowercased so a
 * person matches by ANY name they've gone by, not just their current
 * display_name. Blank fields are omitted.
 */
export function nameTerms(p: NamedPerson): string[] {
  const candidates = [
    p.display_name,
    p.first_name,
    p.last_name,
    p.nickname,
    p.organization,
    p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : undefined,
  ];
  const terms = new Set<string>();
  for (const candidate of candidates) {
    const trimmed = candidate?.trim().toLowerCase();
    if (trimmed) terms.add(trimmed);
  }
  return [...terms];
}
