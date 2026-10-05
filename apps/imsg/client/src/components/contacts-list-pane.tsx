import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { groupContacts } from "@/lib/contact-order";
import { type AirtableHumanRow, type ContactListRow, primaryHandle } from "@/lib/identity";
import { useNameOrder } from "@/lib/settings";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { TriageGeometry } from "@/constants/triage-theme";
import { PersonAvatar } from "./avatar";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { ListRow } from "./list-row";
import { FAVORITE_GOLD } from "./person-crm-section";
import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import { PHONE_TAB_BAR_CLEARANCE } from "./phone-tab-bar";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFooter } from "./sidebar/sidebar-footer";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarHeader } from "./sidebar/sidebar-header";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useSyntheticScrollMetrics } from "./sidebar/use-synthetic-scroll-metrics";
import { headerFace } from "@/lib/header-font";
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";

type Row =
  | { kind: "header"; key: string; letter: string }
  | { kind: "favorites-header"; key: string }
  | { kind: "contact"; key: string; person: ContactListRow; title: string }
  | { kind: "airtable-header"; key: string }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

/** Pinned favorites above A–Z. A favorite appears once, not again below. */
function buildRows(people: ContactListRow[], nameOrder: ReturnType<typeof useNameOrder>): Row[] {
  const rows: Row[] = [];
  const { favorites, alpha } = groupContacts(people, nameOrder);
  if (favorites.length > 0) {
    rows.push({ kind: "favorites-header", key: "favorites-header" });
    for (const { person, title } of favorites) {
      rows.push({ kind: "contact", key: `fav-${person._id}`, person, title });
    }
  }
  let lastLetter: string | null = null;
  for (const { person, title, sectionLetter } of alpha) {
    if (person.is_favorite) continue;
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
  /** A deep-linked person can be selected before their directory row/id is known. */
  hasSelection?: boolean;
  onSelectPerson: (person: ContactListRow) => void;
}

/**
 * Contacts list. On wide layouts this renders the SAME sidebar as Messages,
 * header and footer included, so the two destinations are one window. Search state stays local and
 * independent (name filter + Airtable lookup — no inbox lenses, no deep
 * message search). Plain FlatList by design.
 */
export function ContactsListPane({ wide, selectedId, hasSelection = false, onSelectPerson }: ContactsListPaneProps) {
  const theme = useTheme();
  const visual = useTriageTheme();
  const nameOrder = useNameOrder();
  const [query, setQuery] = useState("");
  const topBarH = wide ? 0 : SIDEBAR_TITLE_HEIGHT;
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

  useEffect(() => {
    if (!wide || hasSelection || selectedId || !filtered?.[0]) return;
    onSelectPerson(filtered[0]);
  }, [filtered, hasSelection, onSelectPerson, selectedId, wide]);

  const rows = useMemo(() => {
    const base = filtered ? buildRows(filtered, nameOrder) : [];
    if (airtableResults.length === 0) return base;
    return [
      ...base,
      { kind: "airtable-header" as const, key: "airtable-header" },
      ...airtableResults.map((h) => ({ kind: "airtable" as const, key: `at-${h.record_id}`, human: h })),
    ];
  }, [filtered, airtableResults, nameOrder]);

  const favoriteCount = useMemo(
    () => (people ? people.filter((p) => p.is_favorite).length : 0),
    [people],
  );

  // Same synthetic thumb as Messages; FlatList's onContentSizeChange is
  // reliable, so it feeds content height directly.
  const metrics = useSyntheticScrollMetrics({
    chromeHeight: topBarH,
    footerHeight: 0,
    estimatedContentHeight: rows.length * TriageGeometry.rowHeight + topBarH + 64,
  });

  const searchField = (
    <SidebarSearchField
      value={query}
      accessibilityLabel="Search contacts"
      placeholder={wide ? "Search people, numbers, orgs" : "Search"}
      onChangeText={setQuery}
      onClear={() => setQuery("")}
    />
  );

  const composeButton = (
    <ChromeIconButton
      hugeIcon={PencilEdit02Icon}
      accessibilityLabel="New message"
      onPress={() => router.push("/new-chat")}
    />
  );

  const sectionHeader = (label: string) => (
    <Text
      style={[
        styles.sectionHeader,
        wide && styles.sectionHeaderWide,
        { color: theme.textTertiary },
        wide ? null : { backgroundColor: theme.background },
      ]}
    >
      {label}
    </Text>
  );

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "header") return sectionHeader(item.letter);
    if (item.kind === "favorites-header") return sectionHeader("Favorites");
    if (item.kind === "airtable-header") return sectionHeader("From Airtable");
    if (item.kind === "airtable") {
      const adding = addingId === item.human.record_id;
      return (
        <ListRow
          paddingHorizontal={wide ? 10 : 12}
          minHeight={wide ? TriageGeometry.rowHeight : undefined}
          style={wide ? styles.rowWide : styles.rowPhone}
          hoverFill={wide ? visual.cardHover : undefined}
          titleWeight="400"
          disabled={adding}
          onPress={() => addAirtableContact(item.human)}
          leading={<PersonAvatar address={null} name={item.human.display_name} size={wide ? 34 : 36} />}
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
        paddingHorizontal={wide ? 10 : 12}
        minHeight={wide ? TriageGeometry.rowHeight : undefined}
        style={wide ? styles.rowWide : styles.rowPhone}
        hoverFill={wide ? visual.cardHover : undefined}
        selectedFill={wide ? visual.cardSelected : undefined}
        titleWeight="400"
        selected={selectedId === item.person._id}
        onPress={() => onSelectPerson(item.person)}
        leading={
          <PersonAvatar address={primaryHandle(item.person) ?? null} name={item.person.display_name} size={wide ? 34 : 36} />
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

  const total = people ? people.length : null;
  const heading = (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.headingTitle, { color: theme.text }]}>Contacts</Text>
      <Text style={[styles.headingMeta, { color: theme.textTertiary }]}>
        {total === null ? "Loading…" : `${total} ${total === 1 ? "person" : "people"}${favoriteCount > 0 ? ` · ${favoriteCount} favorite${favoriteCount === 1 ? "" : "s"}` : ""}`}
      </Text>
    </View>
  );
  const chrome = wide ? (
    <SidebarHeader testID="contacts-desk-header" search={searchField} actions={composeButton} below={heading} />
  ) : (
    <SidebarChrome actions={composeButton} />
  );

  const pane = (
    <SidebarFrame
      chrome={chrome}
      footer={wide ? <SidebarFooter workspace="contacts" /> : null}
      thumb={<SyntheticScrollThumb state={metrics.thumb} />}
    >
      {people === undefined ? (
        <CenteredSpinner style={styles.center} />
      ) : (
        <FlatList
          testID="contacts-list-scroll"
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          // Native-only: RNW treats ANY scroll event as a drag and blurs the
          // focused input (the search focus-theft bug family).
          keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: wide ? 12 : PHONE_TAB_BAR_CLEARANCE,
            paddingHorizontal: TriageGeometry.listGutter,
            paddingTop: wide ? 8 : topBarH + 8,
          }}
          onLayout={(e) => metrics.onViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => metrics.onContentHeight(h)}
          onScroll={metrics.onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={wide ? null : <View style={styles.phoneSearch}>{searchField}</View>}
          ListEmptyComponent={<EmptyState message="No contacts found." style={styles.center} />}
          renderItem={renderRow}
        />
      )}
    </SidebarFrame>
  );

  return pane;
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center", paddingTop: 36 },
  rowWide: { borderRadius: TriageGeometry.rowRadius, marginBottom: TriageGeometry.rowGap },
  rowPhone: { borderRadius: TriageGeometry.rowRadiusMobile, marginBottom: TriageGeometry.rowGap },
  heading: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", paddingBottom: 12 },
  headingTitle: { ...headerFace, fontSize: 15, letterSpacing: -0.15 },
  headingMeta: { fontSize: 12.5 },
  phoneSearch: { flexDirection: "row", paddingBottom: 8 },
  sectionHeader: { fontSize: 13, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 4 },
  sectionHeaderWide: {
    fontSize: 12,
    paddingBottom: 4,
    fontWeight: "400",
    paddingHorizontal: 10,
    paddingTop: 14,
  },
});
