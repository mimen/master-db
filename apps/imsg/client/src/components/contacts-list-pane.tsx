import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { avatarUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import { type AirtableHumanRow, type ContactListRow, primaryHandle } from "@/lib/identity";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { useTheme } from "@/hooks/use-theme";
import { NavSwitcher } from "./nav-switcher";
import { SidebarChrome, chromeStyles } from "./sidebar/sidebar-chrome";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SuggestionSettingsButton } from "./sidebar/suggestion-settings-button";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import {
  SIDEBAR_CHROME_HEIGHT,
  useSyntheticScrollMetrics,
} from "./sidebar/use-synthetic-scroll-metrics";

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
}

/**
 * Contacts list — composed from the same SidebarFrame/Chrome/search-field as
 * the Messages pane, so parity is structural instead of hand-maintained.
 * Search state stays local and independent (name filter + Airtable lookup —
 * no inbox lenses, no deep message search). Plain FlatList by design.
 */
export function ContactsListPane({ wide, selectedId, onSelectPerson }: ContactsListPaneProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const topBarH = SIDEBAR_CHROME_HEIGHT;
  const needle = query.trim().toLowerCase();

  const { results: airtableResults, people, add: addAirtableContact, addingId } = useAirtableSearch(
    needle,
    (personId, human) =>
      onSelectPerson({
        _id: personId,
        display_name: human.display_name,
        normalized_phones: human.phone ? [human.phone] : [],
        normalized_emails: human.email ? [human.email] : [],
      }),
  );

  const filtered = useMemo(() => {
    if (!people) return undefined;
    if (!needle) return people;
    return people.filter((p) => p.display_name.toLowerCase().includes(needle));
  }, [people, needle]);

  const rows = useMemo(() => {
    const base = filtered ? buildRows(filtered) : [];
    if (airtableResults.length === 0) return base;
    return [
      ...base,
      { kind: "airtable-header" as const, key: "airtable-header" },
      ...airtableResults.map((h) => ({ kind: "airtable" as const, key: `at-${h.record_id}`, human: h })),
    ];
  }, [filtered, airtableResults]);

  // Same synthetic thumb as Messages; FlatList's onContentSizeChange is
  // reliable, so it feeds content height directly.
  const metrics = useSyntheticScrollMetrics({
    chromeHeight: topBarH,
    estimatedContentHeight: rows.length * 44 + topBarH + 64,
  });

  const searchField = (
    <SidebarSearchField
      value={query}
      accessibilityLabel="Search contacts"
      placement={wide ? "list-header" : "chrome"}
      onChangeText={setQuery}
      onClear={() => setQuery("")}
    />
  );

  const renderRow = ({ item }: { item: Row }) => {
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
            <Ionicons name="add-circle-outline" size={22} color={theme.accent} />
          )}
        </Pressable>
      );
    }
    return (
      <Pressable
        style={[styles.row, selectedId === item.person._id && { backgroundColor: theme.backgroundSelected }]}
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
  };

  const chrome = (
    <SidebarChrome
      leading={wide ? <NavSwitcher active="contacts" style={styles.navInline} /> : searchField}
      actions={
        <>
          <SuggestionSettingsButton />
          {/* Filters are a Messages concept — present for bar parity, inert here. */}
          <View style={[chromeStyles.actionButton, { opacity: 0.3 }]}>
            <Ionicons name="options-outline" size={21} color={theme.accent} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New message"
            onPress={() => router.push("/new-chat")}
            style={({ pressed }) => [chromeStyles.actionButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="create-outline" size={23} color={theme.accent} />
          </Pressable>
        </>
      }
    />
  );

  return (
    <SidebarFrame chrome={chrome} thumb={<SyntheticScrollThumb state={metrics.thumb} />}>
      {people === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          // Native-only: RNW treats ANY scroll event as a drag and blurs the
          // focused input (the search focus-theft bug family).
          keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 12, paddingTop: topBarH + 8 }}
          onLayout={(e) => metrics.onViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => metrics.onContentHeight(h)}
          onScroll={metrics.onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={wide ? <View style={{ paddingBottom: 6 }}>{searchField}</View> : null}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: theme.textSecondary }}>No contacts found.</Text>
            </View>
          }
          renderItem={renderRow}
        />
      )}
    </SidebarFrame>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center", paddingTop: 36 },
  navInline: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  sectionHeader: { fontSize: 13, fontWeight: "600", paddingHorizontal: 18, paddingVertical: 4 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  avatar: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    overflow: "hidden",
    width: 36,
  },
  avatarImg: { borderRadius: 18, height: 36, position: "absolute", width: 36 },
});
