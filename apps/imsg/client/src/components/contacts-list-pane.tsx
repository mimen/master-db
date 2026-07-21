import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { avatarUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import {
  type AirtableHumanRow,
  type ContactListRow,
  primaryHandle,
  useAddPersonFromAirtable,
  useListPeople,
  useSearchAirtableHumans,
} from "@/lib/identity";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";

type Row =
  | { kind: "header"; key: string; letter: string }
  | { kind: "contact"; key: string; person: ContactListRow }
  | { kind: "airtable-header"; key: string }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

function sectionLetter(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

function buildRows(people: ContactListRow[]): Row[] {
  const rows: Row[] = [];
  let lastLetter: string | null = null;
  for (const p of people) {
    const letter = sectionLetter(p.display_name);
    if (letter !== lastLetter) {
      rows.push({ kind: "header", key: `h-${letter}`, letter });
      lastLetter = letter;
    }
    rows.push({ kind: "contact", key: p._id, person: p });
  }
  return rows;
}

export interface ContactsListPaneProps {
  wide: boolean;
  selectedId?: string;
  onSelectPerson: (person: ContactListRow) => void;
  /** Desktop-only: switch the left column back to the conversation list. */
  onBackToMessages?: () => void;
}

/** Contacts list, shared by the mobile /contacts modal and the desktop left-column pane. */
export function ContactsListPane({ wide, selectedId, onSelectPerson, onBackToMessages }: ContactsListPaneProps) {
  const theme = useTheme();
  const people = useListPeople();
  const [query, setQuery] = useState("");
  const [airtableResults, setAirtableResults] = useState<AirtableHumanRow[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const searchAirtable = useSearchAirtableHumans();
  const addFromAirtable = useAddPersonFromAirtable();

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!people) return undefined;
    if (!needle) return people;
    return people.filter((p) => p.display_name.toLowerCase().includes(needle));
  }, [people, needle]);

  // Existing contacts always come first. Airtable is a live, debounced
  // secondary search — matches you already have (by airtable_human_id)
  // are filtered out so nobody appears twice.
  useEffect(() => {
    if (needle.length < 2) {
      setAirtableResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchAirtable({ query: needle })
        .then((results) => {
          if (cancelled) return;
          const alreadyLinked = new Set((people ?? []).map((p) => p.airtable_human_id).filter(Boolean));
          setAirtableResults(results.filter((r) => !alreadyLinked.has(r.record_id)));
        })
        .catch(() => !cancelled && setAirtableResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [needle, people, searchAirtable]);

  const rows = useMemo(() => {
    const base = filtered ? buildRows(filtered) : [];
    if (airtableResults.length === 0) return base;
    return [
      ...base,
      { kind: "airtable-header" as const, key: "airtable-header" },
      ...airtableResults.map((h) => ({ kind: "airtable" as const, key: `at-${h.record_id}`, human: h })),
    ];
  }, [filtered, airtableResults]);

  const addAirtableContact = async (human: AirtableHumanRow) => {
    setAddingId(human.record_id);
    try {
      const result = await addFromAirtable({
        record_id: human.record_id,
        display_name: human.display_name,
        phone: human.phone,
        email: human.email,
      });
      setAirtableResults((current) => current.filter((r) => r.record_id !== human.record_id));
      onSelectPerson({
        _id: result.personId,
        display_name: human.display_name,
        normalized_phones: human.phone ? [human.phone] : [],
        normalized_emails: human.email ? [human.email] : [],
      });
    } catch {
      showToast("Couldn't add contact");
    } finally {
      setAddingId(null);
    }
  };

  return (
    <SafeAreaView
      style={[styles.pane, wide && styles.paneWide, wide && { borderRightColor: theme.divider }, { backgroundColor: theme.background }]}
      edges={["top"]}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: theme.text }]}>Contacts</Text>
        {onBackToMessages && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Messages"
            onPress={onBackToMessages}
            style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={21} color={theme.accent} />
          </Pressable>
        )}
      </View>

      <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={17} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
        />
      </View>

      {people === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary }}>No contacts found.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <Text style={[styles.sectionHeader, { color: theme.textSecondary, backgroundColor: theme.background }]}>
                  {item.letter}
                </Text>
              );
            }
            if (item.kind === "airtable-header") {
              return (
                <Text style={[styles.sectionHeader, { color: theme.textSecondary, backgroundColor: theme.background }]}>
                  From Airtable
                </Text>
              );
            }
            if (item.kind === "airtable") {
              const adding = addingId === item.human.record_id;
              return (
                <Pressable style={styles.row} disabled={adding} onPress={() => addAirtableContact(item.human)}>
                  <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                    <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "600" }}>
                      {initials(item.human.display_name)}
                    </Text>
                  </View>
                  <Text style={{ color: theme.text, fontSize: 16, flex: 1 }}>{item.human.display_name}</Text>
                  {adding ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Ionicons name="add-circle-outline" size={22} color="#0A84FF" />
                  )}
                </Pressable>
              );
            }
            return (
              <Pressable
                style={[styles.row, selectedId === item.person._id && { backgroundColor: theme.backgroundElement }]}
                onPress={() => onSelectPerson(item.person)}
              >
                <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "600" }}>
                    {initials(item.person.display_name)}
                  </Text>
                  {primaryHandle(item.person) && (
                    <Image
                      source={{ uri: avatarUrl(primaryHandle(item.person) as string) }}
                      style={styles.avatarImg}
                      contentFit="cover"
                    />
                  )}
                </View>
                <Text style={{ color: theme.text, fontSize: 16 }}>{item.person.display_name}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  paneWide: {
    borderRightWidth: StyleSheet.hairlineWidth,
    flexBasis: 390,
    flexGrow: 0,
    flexShrink: 0,
    width: 390,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: { fontSize: 28, fontWeight: "700" },
  titleButton: { padding: 4 },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 16 },
  sectionHeader: { fontSize: 13, fontWeight: "600", paddingHorizontal: 16, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { position: "absolute", width: 36, height: 36, borderRadius: 18 },
});
