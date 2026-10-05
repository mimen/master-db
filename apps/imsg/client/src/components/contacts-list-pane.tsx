import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { useTheme } from "@/hooks/use-theme";
import { TriageGeometry } from "@/constants/triage-theme";
import {
  contactSecondary,
  contactSections,
  findDuplicates,
  matchesContact,
  recentPeopleIds,
  serviceIndex,
  type ContactRow,
  type DuplicatePair,
} from "@/lib/contact-order";
import { headerFace } from "@/lib/header-font";
import { type AirtableHumanRow, type ContactListRow, primaryHandle } from "@/lib/identity";
import { useNameOrder } from "@/lib/settings";
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";
import { PersonAvatar } from "./avatar";
import { ServiceDot } from "./contacts-theme";
import { PHONE_TAB_BAR_CLEARANCE } from "./phone-tab-bar";
import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFooter } from "./sidebar/sidebar-footer";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarHeader } from "./sidebar/sidebar-header";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useSyntheticScrollMetrics } from "./sidebar/use-synthetic-scroll-metrics";

type Row =
  | ContactRow<ContactListRow>
  | { kind: "airtable-header"; key: string }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

const RECENT_LIMIT = 3;
const INDEX_LETTERS = ["★", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

export interface ContactsListPaneProps {
  wide: boolean;
  selectedId?: string;
  /** A deep-linked person can be selected before their directory row/id is known. */
  hasSelection?: boolean;
  onSelectPerson: (person: ContactListRow) => void;
  onReviewDuplicates: (pairs: DuplicatePair<ContactListRow>[]) => void;
  onAddContact: () => void;
}

/**
 * The People list inside the same sidebar as Messages (header, footer and
 * scroll thumb included): search across people, numbers and orgs, the
 * possible-duplicates notice, then Favorites, Recent and A to Z. Each row
 * shows one service dot per handle. The phone adds a trailing A to Z index.
 */
export function ContactsListPane({ wide, selectedId, hasSelection = false, onSelectPerson, onReviewDuplicates, onAddContact }: ContactsListPaneProps) {
  const theme = useTheme();
  const nameOrder = useNameOrder();
  const chats = useChatDirectory();
  const listRef = useRef<FlatList<Row>>(null);
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

  const serviceOf = useMemo(() => serviceIndex(chats ?? []), [chats]);
  const duplicates = useMemo(() => (people ? findDuplicates(people) : []), [people]);
  const duplicateIds = useMemo(() => new Set(duplicates.map((d) => d.other._id)), [duplicates]);

  const filtered = useMemo(() => people?.filter((p) => matchesContact(p, needle)), [people, needle]);

  useEffect(() => {
    if (!wide || hasSelection || selectedId || !filtered?.[0]) return;
    onSelectPerson(filtered[0]);
  }, [filtered, hasSelection, onSelectPerson, selectedId, wide]);

  const rows = useMemo<Row[]>(() => {
    if (!filtered) return [];
    const recent = needle ? [] : recentPeopleIds(filtered, chats ?? [], RECENT_LIMIT);
    const base: Row[] = contactSections(filtered, nameOrder, recent);
    if (airtableResults.length === 0) return base;
    return [
      ...base,
      { kind: "airtable-header", key: "airtable-header" },
      ...airtableResults.map((h) => ({ kind: "airtable" as const, key: `at-${h.record_id}`, human: h })),
    ];
  }, [filtered, airtableResults, nameOrder, chats, needle]);

  // The full iOS index; a letter with no section jumps to the next one that exists.
  const indexLetters = useMemo(() => {
    const sections = rows.flatMap((r, index) => (r.kind === "section" && r.letter ? [{ letter: r.letter, index }] : []));
    return INDEX_LETTERS.flatMap((letter) => {
      const hit = sections.find((s) => s.letter === letter) ??
        (letter === "★" || letter === "#" ? undefined : sections.find((s) => /[A-Z]/.test(s.letter) && s.letter >= letter));
      return hit ? [{ letter, index: hit.index }] : [];
    });
  }, [rows]);

  // Same synthetic thumb as Messages; FlatList's onContentSizeChange is
  // reliable, so it feeds content height directly.
  const metrics = useSyntheticScrollMetrics({
    chromeHeight: topBarH,
    footerHeight: 0,
    estimatedContentHeight: rows.length * TriageGeometry.rowHeight + topBarH + 64,
  });

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "section" || item.kind === "airtable-header") {
      const label = item.kind === "section" ? item.label : "From Airtable";
      const count = item.kind === "section" && wide ? item.count : undefined;
      return (
        <View style={[styles.group, !wide && styles.groupPhone]}>
          <Text accessibilityRole="header" style={[styles.groupLabel, !wide && styles.groupLabelPhone, { color: theme.textTertiary }]}>{label}</Text>
          {count !== undefined ? <Text style={[styles.groupLabel, { color: theme.textTertiary }]}>{count}</Text> : null}
        </View>
      );
    }
    if (item.kind === "airtable") {
      const adding = addingId === item.human.record_id;
      return (
        <PersonRow
          wide={wide}
          title={item.human.display_name}
          secondary="Add from Airtable"
          avatar={<PersonAvatar address={null} name={item.human.display_name} size={wide ? 32 : 42} />}
          trailing={adding ? <ActivityIndicator size="small" /> : <Ionicons name="add-circle-outline" size={18} color={theme.icon} />}
          onPress={() => addAirtableContact(item.human)}
        />
      );
    }
    const person = item.person;
    const handles = [...person.normalized_phones, ...person.normalized_emails];
    return (
      <PersonRow
        wide={wide}
        selected={wide && selectedId === person._id}
        title={item.title}
        duplicate={duplicateIds.has(person._id)}
        secondary={contactSecondary(person)}
        avatar={<PersonAvatar address={primaryHandle(person)} name={person.display_name} size={wide ? 32 : 42} />}
        trailing={
          <View style={styles.dots} accessibilityLabel={handles.map(serviceOf).join(", ")}>
            {handles.slice(0, 3).map((h) => <ServiceDot key={h} service={serviceOf(h)} size={wide ? 7 : 9} />)}
          </View>
        }
        onPress={() => onSelectPerson(person)}
      />
    );
  };

  const searchField = (
    <SidebarSearchField
      value={query}
      accessibilityLabel="Search contacts"
      placeholder="Search people, numbers, orgs"
      onChangeText={setQuery}
      onClear={() => setQuery("")}
    />
  );

  const actions = (
    <>
      <ChromeIconButton hugeIcon={UserAdd01Icon} accessibilityLabel="Add contact" onPress={onAddContact} />
      <ChromeIconButton hugeIcon={PencilEdit02Icon} accessibilityLabel="New message" onPress={() => router.push("/new-chat")} />
    </>
  );

  const total = people?.length ?? null;
  const heading = (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.headingTitle, { color: theme.text }]}>Contacts</Text>
      <Text style={[styles.headingMeta, { color: theme.textTertiary }]}>
        {total === null ? "" : `${total.toLocaleString("en-US")} ${total === 1 ? "person" : "people"}`}
      </Text>
    </View>
  );

  const notice = duplicates.length > 0 && !needle ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${duplicates.length} possible ${duplicates.length === 1 ? "duplicate" : "duplicates"}. Review`}
      onPress={() => onReviewDuplicates(duplicates)}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.suggest,
        !wide && styles.suggestPhone,
        wide
          ? { backgroundColor: theme.surface, borderColor: theme.dividerStrong, borderWidth: 1 }
          : { backgroundColor: theme.field },
        (hovered || pressed) && { backgroundColor: theme.rowHover },
      ]}
    >
      <Ionicons name="git-merge-outline" size={wide ? 15 : 20} color={theme.icon} />
      <Text style={[styles.suggestText, !wide && styles.suggestTextPhone, { color: theme.text }]}>
        {duplicates.length} possible {duplicates.length === 1 ? "duplicate" : "duplicates"}
      </Text>
      <Text style={[styles.suggestGo, !wide && styles.suggestTextPhone, { color: theme.text }]}>Review</Text>
    </Pressable>
  ) : null;

  const listHeader = wide ? notice : (
    <View>
      <Text accessibilityRole="header" style={[styles.phoneTitle, { color: theme.text }]}>Contacts</Text>
      <View style={styles.phoneSearch}>{searchField}</View>
      {notice}
    </View>
  );

  const chrome = wide ? (
    <SidebarHeader testID="contacts-desk-header" search={searchField} actions={actions} below={heading} />
  ) : (
    <SidebarChrome actions={actions} />
  );

  return (
    <SidebarFrame
      chrome={chrome}
      footer={wide ? <SidebarFooter workspace="contacts" /> : null}
      thumb={<SyntheticScrollThumb state={metrics.thumb} />}
    >
      {people === undefined ? (
        <ActivityIndicator style={styles.center} />
      ) : (
        <>
          <FlatList
            ref={listRef}
            testID="contacts-list-scroll"
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            // Native-only: RNW treats ANY scroll event as a drag and blurs the
            // focused input (the search focus-theft bug family).
            keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={listHeader}
            contentContainerStyle={wide ? styles.listContent : [styles.listContentPhone, { paddingTop: topBarH }]}
            onLayout={(e) => metrics.onViewportHeight(e.nativeEvent.layout.height)}
            onContentSizeChange={(_w, h) => metrics.onContentHeight(h)}
            onScroll={metrics.onScroll}
            scrollEventThrottle={16}
            onScrollToIndexFailed={({ averageItemLength, index }) =>
              listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false })}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.textTertiary }]}>
                {needle ? `No one matches “${query.trim()}”. Searched names, numbers and organizations.` : "No contacts yet."}
              </Text>
            }
            renderItem={renderRow}
          />
          {!wide && !needle && indexLetters.length > 1 ? (
            <View style={[styles.index, { top: topBarH }]} accessibilityLabel="Section index">
              {indexLetters.map(({ letter, index }) => (
                <Pressable
                  key={letter}
                  accessibilityRole="button"
                  accessibilityLabel={letter === "★" ? "Favorites" : `Jump to ${letter}`}
                  hitSlop={{ left: 12, right: 6 }}
                  onPress={() => listRef.current?.scrollToIndex({ index, animated: false })}
                >
                  <Text style={[styles.indexLetter, { color: theme.textSecondary }]}>{letter}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </SidebarFrame>
  );
}

/** A flat inset pill, as chat-row: fill changes on hover and selection, nothing moves. */
function PersonRow({ wide, selected, title, secondary, duplicate, avatar, trailing, onPress }: {
  readonly wide: boolean;
  readonly selected?: boolean;
  readonly title: string;
  readonly secondary: string;
  readonly duplicate?: boolean;
  readonly avatar: React.ReactNode;
  readonly trailing: React.ReactNode;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID="contact-row"
      accessibilityRole="button"
      accessibilityLabel={[title, duplicate ? "possible duplicate" : null, secondary].filter(Boolean).join(", ")}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ hovered, pressed, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) => [
        styles.row,
        wide ? styles.rowWide : styles.rowPhone,
        { backgroundColor: selected || pressed ? theme.rowSelected : hovered ? theme.rowHover : "transparent" },
        focused && ({ outlineColor: theme.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: -2 } as object),
      ]}
    >
      {avatar}
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          <Text numberOfLines={1} style={[styles.name, !wide && styles.namePhone, { color: theme.text }]}>{title}</Text>
          {duplicate ? (
            <Text style={[styles.dupTag, { color: theme.textSecondary, borderColor: theme.dividerStrong }]}>Duplicate</Text>
          ) : null}
        </View>
        {secondary ? <Text numberOfLines={1} style={[styles.secondary, !wide && styles.secondaryPhone, { color: theme.textSecondary }]}>{secondary}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, paddingTop: 36 },
  listContent: { paddingBottom: 12, paddingHorizontal: TriageGeometry.listGutter },
  listContentPhone: { paddingBottom: PHONE_TAB_BAR_CLEARANCE, paddingLeft: 20, paddingRight: 28 },
  heading: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", paddingBottom: 12 },
  headingTitle: { ...headerFace, fontSize: 15, letterSpacing: -0.15 },
  headingMeta: { fontSize: 12, fontVariant: ["tabular-nums"] },
  phoneTitle: { ...headerFace, fontSize: 26, letterSpacing: -0.5, paddingBottom: 12, paddingTop: 4 },
  phoneSearch: { flexDirection: "row", marginRight: -8 },
  suggest: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 10, marginBottom: 4, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10 },
  suggestPhone: { borderRadius: 14, gap: 14, marginRight: -8, marginTop: 12, paddingHorizontal: 16, paddingVertical: 12 },
  suggestText: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  suggestTextPhone: { fontSize: 16 },
  suggestGo: { fontSize: 12.5, fontWeight: "600" },
  group: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 6, paddingHorizontal: 10, paddingTop: 14 },
  groupPhone: { paddingHorizontal: 0, paddingTop: 18 },
  groupLabel: { fontSize: 11.5, fontVariant: ["tabular-nums"] },
  groupLabelPhone: { fontSize: 13 },
  row: { alignItems: "center", flexDirection: "row" },
  rowWide: { borderRadius: TriageGeometry.rowRadius, gap: 10, marginBottom: TriageGeometry.rowGap, paddingBottom: 10, paddingHorizontal: 10, paddingTop: 9 },
  rowPhone: { borderRadius: TriageGeometry.rowRadiusMobile, gap: 14, marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 8 },
  rowText: { flex: 1, minWidth: 0 },
  nameLine: { alignItems: "center", flexDirection: "row", gap: 6 },
  name: { flexShrink: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  namePhone: { fontSize: 16, lineHeight: 21 },
  secondary: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  secondaryPhone: { fontSize: 14, lineHeight: 19 },
  dupTag: { borderRadius: 5, borderWidth: 1, fontSize: 11, fontWeight: "600", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1 },
  dots: { flexDirection: "row", gap: 3 },
  empty: { fontSize: 13, paddingHorizontal: 12, paddingTop: 24, textAlign: "center" },
  index: { alignItems: "center", bottom: PHONE_TAB_BAR_CLEARANCE, justifyContent: "center", position: "absolute", right: 2, width: 18 },
  indexLetter: { fontSize: 11, fontWeight: "600", lineHeight: 15 },
});
