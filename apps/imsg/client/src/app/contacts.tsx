import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { avatarUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import { type ContactListRow, primaryHandle, useListPeople } from "@/lib/identity";
import { useTheme } from "@/hooks/use-theme";

type Row = { kind: "header"; key: string; letter: string } | { kind: "contact"; key: string; person: ContactListRow };

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

export default function ContactsScreen() {
  const theme = useTheme();
  const people = useListPeople();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!people) return undefined;
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((p) => p.display_name.toLowerCase().includes(needle));
  }, [people, query]);

  const rows = useMemo(() => (filtered ? buildRows(filtered) : []), [filtered]);

  const openPerson = (p: ContactListRow) => {
    const address = primaryHandle(p);
    if (!address) return;
    router.push({ pathname: "/person", params: { address, name: p.display_name } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
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
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <Text style={[styles.sectionHeader, { color: theme.textSecondary, backgroundColor: theme.background }]}>
                {item.letter}
              </Text>
            ) : (
              <Pressable style={styles.row} onPress={() => openPerson(item.person)}>
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
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
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
