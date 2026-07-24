import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  type AirtableHumanRow,
  type ContactListRow,
  useAddPersonFromAirtable,
  useListPeople,
  useSearchAirtableHumans,
} from "@/lib/identity";
import { showToast } from "@/lib/toast";

export interface UseAirtableSearchResult {
  /** Airtable Humans matching the query that AREN'T already one of your contacts. */
  results: AirtableHumanRow[];
  /** Your existing contacts — callers that also list local contacts alongside Airtable results reuse this instead of a second useListPeople(). */
  people: ContactListRow[] | undefined;
  /** Links the person into the identity graph, removes them from `results`, then calls onAdded. */
  add: (human: AirtableHumanRow) => Promise<void>;
  /** The record_id currently being added, for a per-row spinner. */
  addingId: string | null;
}

/**
 * Debounced Airtable Humans search, filtered to exclude people you already
 * have (by airtable_human_id), plus the add-and-link flow. Shared by the
 * Contacts screen and the New Message screen — both search "existing
 * contacts first, unlinked Airtable matches below," and both need the same
 * add/dedupe/evict behavior when you tap a result.
 */
export function useAirtableSearch(needle: string, onAdded: (personId: string, human: AirtableHumanRow) => void): UseAirtableSearchResult {
  const people = useListPeople();
  // Raw Airtable matches, unfiltered — the already-linked exclusion is
  // computed at render time (below), not here. Keeping `people` out of this
  // effect's deps means an unrelated people-table change (e.g. a rename
  // elsewhere) never re-fires the remote Airtable search.
  const [rawResults, setRawResults] = useState<AirtableHumanRow[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const searchAirtable = useSearchAirtableHumans();
  const addFromAirtable = useAddPersonFromAirtable();

  useEffect(() => {
    if (needle.length < 2) {
      setRawResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchAirtable({ query: needle })
        .then((found) => {
          if (!cancelled) setRawResults(found);
        })
        .catch(() => !cancelled && setRawResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [needle, searchAirtable]);

  const results = useMemo(() => {
    const alreadyLinked = new Set((people ?? []).map((p) => p.airtable_human_id).filter(Boolean));
    return rawResults.filter((r) => !alreadyLinked.has(r.record_id));
  }, [rawResults, people]);

  const add = async (human: AirtableHumanRow) => {
    setAddingId(human.record_id);
    try {
      const result = await addFromAirtable({
        record_id: human.record_id,
        display_name: human.display_name,
        first_name: human.first_name,
        last_name: human.last_name,
        phone: human.phone,
        email: human.email,
      });
      // Local eviction ahead of `people` catching up via Convex reactivity.
      setRawResults((current) => current.filter((r) => r.record_id !== human.record_id));
      onAdded(result.personId, human);
      void api.refreshIdentity().catch(() => undefined);
    } catch {
      showToast("Couldn't add contact");
    } finally {
      setAddingId(null);
    }
  };

  return { results, people, add, addingId };
}
