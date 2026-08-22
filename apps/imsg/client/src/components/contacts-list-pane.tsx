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
import { ContactsSummary } from "./contacts-summary";
import { DeskHeader, DESK_HEADER_HEIGHT } from "./desk-header";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { ListRow } from "./list-row";
import { FAVORITE_GOLD } from "./person-crm-section";
import { TriageNavigationRail } from "./triage-navigation-rail";
import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import { SettingsButton } from "./sidebar/settings-button";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useSyntheticScrollMetrics } from "./sidebar/use-synthetic-scroll-metrics";
import { sidebarChromeHeight } from "@/lib/sidebar-metrics";

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
  onSelectPerson: (person: ContactListRow) => void;
}

/**
 * Contacts list. On wide layouts this renders the SAME shell as Messages —
 * the navigation rail plus the shared DeskHeader over floating cards — so the
 * two destinations are one window, not two apps. Search state stays local and
 * independent (name filter + Airtable lookup — no inbox lenses, no deep
 * message search). Plain FlatList by design.
 */
export function ContactsListPane({ wide, selectedId, onSelectPerson }: ContactsListPaneProps) {
  const theme = useTheme();
  const visual = useTriageTheme();
  const nameOrder = useNameOrder();
  const [query, setQuery] = useState("");
  const topBarH = wide ? DESK_HEADER_HEIGHT : sidebarChromeHeight(false);
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
    if (!wide || selectedId || !filtered?.[0]) return;
    onSelectPerson(filtered[0]);
  }, [filtered, onSelectPerson, selectedId, wide]);

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
    estimatedContentHeight: rows.length * (TriageGeometry.rowHeight + TriageGeometry.rowGap) + topBarH + 64,
  });

  const searchField = (
    <SidebarSearchField
      value={query}
      accessibilityLabel="Search contacts"
      placement="chrome"
      onChangeText={setQuery}
      onClear={() => setQuery("")}
    />
  );

  const composeButton = (
    <ChromeIconButton
      icon="create-outline"
      accessibilityLabel="New message"
      onPress={() => router.push("/new-chat")}
    />
  );

  const sectionHeader = (label: string) => (
    <Text
      style={[
        styles.sectionHeader,
        wide && styles.sectionHeaderWide,
        { color: wide ? visual.meta : theme.textSecondary },
        wide ? null : { backgroundColor: theme.background },
      ]}
    >
      {label}
    </Text>
  );

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "header") return sectionHeader(item.letter);
    if (item.kind === "favorites-header") return sectionHeader("★ Favorites");
    if (item.kind === "airtable-header") return sectionHeader("From Airtable");
    if (item.kind === "airtable") {
      const adding = addingId === item.human.record_id;
      return (
        <ContactCard wide={wide}>
          <ListRow
            paddingHorizontal={wide ? 12 : 18}
            minHeight={wide ? TriageGeometry.rowHeight : undefined}
            hoverFill={wide ? visual.cardHover : undefined}
            selectedFill={wide ? visual.cardSelected : undefined}
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
        </ContactCard>
      );
    }
    return (
      <ContactCard wide={wide} selected={selectedId === item.person._id}>
        <ListRow
          paddingHorizontal={wide ? 12 : 18}
          minHeight={wide ? TriageGeometry.rowHeight : undefined}
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
      </ContactCard>
    );
  };

  const chrome = wide ? (
    <DeskHeader
      testID="contacts-desk-header"
      summary={<ContactsSummary total={people ? people.length : null} favorites={favoriteCount} />}
      search={searchField}
      action={composeButton}
    />
  ) : (
    <SidebarChrome
      leading={searchField}
      actions={
        <>
          <SettingsButton />
          {composeButton}
        </>
      }
    />
  );

  const pane = (
    <SidebarFrame
      chrome={chrome}
      chromeHeight={topBarH}
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
            paddingBottom: 12,
            paddingHorizontal: wide ? TriageGeometry.listGutter : 0,
            paddingTop: Platform.OS === "web" && wide ? 0 : topBarH + 8,
          }}
          onLayout={(e) => metrics.onViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => metrics.onContentHeight(h)}
          onScroll={metrics.onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            wide ? <View style={{ paddingTop: Platform.OS === "web" ? topBarH + 8 : 0 }} /> : null
          }
          ListEmptyComponent={<EmptyState message="No contacts found." style={styles.center} />}
          renderItem={renderRow}
        />
      )}
    </SidebarFrame>
  );

  if (!wide) return pane;
  return (
    <View style={styles.desktopDesk}>
      <TriageNavigationRail destination="contacts" />
      <View style={styles.desktopList}>{pane}</View>
    </View>
  );
}

/** Floating card wrapper — the same geometry ChatRow uses on the desk, so
 * contact rows read as the same material as conversation rows instead of
 * letting the desk gradient wash through a flat list. */
function ContactCard({
  wide,
  selected = false,
  children,
}: {
  wide: boolean;
  selected?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const visual = useTriageTheme();
  if (!wide) return <>{children}</>;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: selected ? visual.cardSelected : visual.card,
          ...(Platform.OS === "web"
            ? ({ boxShadow: `0 1px 3px ${visual.cardShadow}` } as object)
            : null),
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  desktopDesk: { flex: 1, flexDirection: "row" },
  desktopList: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", flex: 1, justifyContent: "center", paddingTop: 36 },
  card: {
    borderRadius: TriageGeometry.rowRadius,
    marginBottom: TriageGeometry.rowGap,
    overflow: "hidden",
  },
  sectionHeader: { fontSize: 13, fontWeight: "600", paddingHorizontal: 18, paddingVertical: 4 },
  sectionHeaderWide: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    paddingBottom: 6,
    paddingHorizontal: 6,
    paddingTop: 10,
    textTransform: "uppercase",
  },
});
