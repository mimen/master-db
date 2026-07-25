import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AirtableEventRow, EventLink } from "@/lib/identity";
import { useSearchEvents } from "@/lib/identity";
import { useTheme } from "@/hooks/use-theme";
import { Radii, Type } from "@/constants/theme";
import { showToast } from "@/lib/toast";

export interface CrmEventsEditorProps {
  events: EventLink[];
  onLink: (record: AirtableEventRow) => Promise<void>;
  onUnlink: (linkId: string) => void;
}

/**
 * Shared event/project-association editor — linked-event chips (with
 * unlink) plus a debounced Airtable Events search-to-add row. Reused by
 * PersonCrmSection and ChatCrmSection (person and GROUP chat both support
 * event links, same UI either way — see convex/schema/identity/event_links.ts).
 * Owner-agnostic: the caller's onLink/onUnlink close over personId/chatGuid.
 */
export function CrmEventsEditor({ events, onLink, onUnlink }: CrmEventsEditorProps) {
  const theme = useTheme();
  const searchEvents = useSearchEvents();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AirtableEventRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const runSearch = (text: string) => {
    setQuery(text);
    const needle = text.trim();
    if (needle.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchEvents({ query: needle })
      .then(setResults)
      .catch(() => showToast("Couldn't search events"))
      .finally(() => setSearching(false));
  };

  const link = async (record: AirtableEventRow) => {
    setLinkingId(record.record_id);
    try {
      await onLink(record);
      setQuery("");
      setResults([]);
    } catch {
      showToast("Couldn't link event");
    } finally {
      setLinkingId(null);
    }
  };

  const alreadyLinked = new Set(events.map((e) => e.id));

  return (
    <View style={styles.wrap}>
      {events.length > 0 && (
        <View style={styles.chipRow}>
          {events.map((e) => (
            <View key={e.linkId} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="calendar-outline" size={12} color={theme.textSecondary} />
              <Text style={[styles.chipLabel, { color: theme.text }]}>{e.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unlink ${e.name}`}
                hitSlop={6}
                onPress={() => onUnlink(e.linkId)}
              >
                <Ionicons name="close" size={12} color={theme.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={[styles.searchWrap, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={13} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={runSearch}
          placeholder="Link an event…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {searching && <ActivityIndicator size="small" />}
      </View>
      {results.length > 0 && (
        <View style={[styles.results, { backgroundColor: theme.backgroundElement }]}>
          {results
            .filter((r) => !alreadyLinked.has(r.record_id))
            .map((r) => (
              <Pressable
                key={r.record_id}
                disabled={linkingId === r.record_id}
                onPress={() => link(r)}
                style={styles.resultRow}
              >
                <Text style={{ color: theme.text, fontSize: Type.secondary }} numberOfLines={1}>
                  {r.name}
                </Text>
                {linkingId === r.record_id ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Ionicons name="add-circle-outline" size={16} color={theme.accent} />
                )}
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  chipRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    alignItems: "center",
    borderRadius: Radii.chip,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipLabel: { fontSize: Type.secondary },
  searchWrap: {
    alignItems: "center",
    borderRadius: Radii.chip,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: { flex: 1, fontSize: Type.secondary, paddingVertical: 2 },
  results: { borderRadius: Radii.input, overflow: "hidden" },
  resultRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
