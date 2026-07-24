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
import { router } from "expo-router";
import { orderContacts } from "@/lib/contact-order";
import { type AirtableHumanRow, type ContactListRow, primaryHandle } from "@/lib/identity";
import { useNameOrder } from "@/lib/settings";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { useTheme } from "@/hooks/use-theme";
import { PersonAvatar } from "./avatar";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { ListRow } from "./list-row";
import { FAVORITE_GOLD } from "./person-crm-section";
import { NavSwitcher } from "./nav-switcher";
import { SettingsButton } from "./sidebar/settings-button";
import { SidebarChrome, chromeStyles } from "./sidebar/sidebar-chrome";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import {
  SIDEBAR_CHROME_HEIGHT,
  useSyntheticScrollMetrics,
} from "./sidebar/use-synthetic-scroll-metrics";

type Row =
  | { kind: "header"; key: string; letter: string }
  | { kind: "contact"; key: string; person: ContactListRow; title: string }
  | { kind: "airtable-header"; key: string }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

function buildRows(people: ContactListRow[], nameOrder: ReturnType<typeof useNameOrder>): Row[] {
  const rows: Row[] = [];
  let lastLetter: string | null = null;
  for (const { person, title, sectionLetter } of orderContacts(people, nameOrder)) {
    if (sectionLetter !== lastLetter) {
      rows.push({ kind: "header", key: `h-${sectionLetter}`, letter: sectionLetter });
      lastLetter = sectionLetter;
    }
    rows.push({ kind: "contact", key: person._id, person, title });
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
  const nameOrder = useNameOrder();
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
    const base = filtered ? buildRows(filtered, nameOrder) : [];
    if (airtableResults.length === 0) return base;
    return [
      ...base,
      { kind: "airtable-header" as const, key: "airtable-header" },
      ...airtableResults.map((h) => ({ kind: "airtable" as const, key: `at-${h.record_id}`, human: h })),
    ];
  }, [filtered, airtableResults, nameOrder]);

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
        <ListRow
          paddingHorizontal={18}
          titleWeight="400"
          disabled={adding}
          onPress={() => addAirtableContact(item.human)}
          leading={<PersonAvatar address={null} name={item.human.display_name} size={36} />}
          title={item.human.display_name}
          trailing={
            adding ? (
              <ActivityIndicator size="small" />
            ) : (
              <Ionicons name="add-circle-outline" size={22} color={theme.accent} />
            )
          }
        />
      );
    }
    return (
      <ListRow
        paddingHorizontal={18}
        titleWeight="400"
        selected={selectedId === item.person._id}
        onPress={() => onSelectPerson(item.person)}
        leading={
          <PersonAvatar address={primaryHandle(item.person) ?? null} name={item.person.display_name} size={36} />
        }
        title={item.title}
        trailing={
          item.person.is_favorite ? (
            <Ionicons name="star" size={15} color={FAVORITE_GOLD} accessibilityLabel="Favorite" />
          ) : undefined
        }
      />
    );
  };

  const chrome = (
    <SidebarChrome
      leading={wide ? <NavSwitcher active="contacts" style={styles.navInline} /> : searchField}
      actions={
        <>
          <SettingsButton />
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
        <CenteredSpinner style={styles.center} />
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
          ListEmptyComponent={<EmptyState message="No contacts found." style={styles.center} />}
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
});
