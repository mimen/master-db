import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
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
import { type AirtableHumanRow, type ContactListRow, primaryHandle } from "@/lib/identity";
import { useNameOrder } from "@/lib/settings";
import { PersonAvatar } from "./avatar";
import { HEADER_FONT, ServiceDot, useSignal } from "./contacts-theme";

type Row =
  | ContactRow<ContactListRow>
  | { kind: "airtable-header"; key: string }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

const RECENT_LIMIT = 3;
const INDEX_LETTERS = ["★", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

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
 * The People list: search across people, numbers and orgs, the possible-
 * duplicates notice, then Favorites, Recent and A to Z. Each row shows one
 * service dot per handle. The phone adds a trailing A to Z index.
 */
export function ContactsListPane({ wide, selectedId, hasSelection = false, onSelectPerson, onReviewDuplicates, onAddContact }: ContactsListPaneProps) {
  const colors = useSignal();
  const nameOrder = useNameOrder();
  const chats = useChatDirectory();
  const listRef = useRef<FlatList<Row>>(null);
  const [query, setQuery] = useState("");
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

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "section") {
      return (
        <View style={[styles.group, !wide && styles.groupPhone]}>
          <Text accessibilityRole="header" style={[styles.groupLabel, !wide && styles.groupLabelPhone, { color: colors.textTertiary }]}>{item.label}</Text>
          {item.count !== undefined && wide ? <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>{item.count}</Text> : null}
        </View>
      );
    }
    if (item.kind === "airtable-header") {
      return (
        <View style={[styles.group, !wide && styles.groupPhone]}>
          <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>From Airtable</Text>
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
          trailing={adding ? <ActivityIndicator size="small" /> : <Ionicons name="add-circle-outline" size={18} color={colors.icon} />}
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

  const total = people?.length ?? null;
  const search = (
    <View style={[styles.searchRow, !wide && styles.searchRowPhone]} {...NO_DRAG}>
      <View style={[styles.field, !wide && styles.fieldPhone, { backgroundColor: colors.field }]}>
        <Ionicons name="search" size={wide ? 15 : 19} color={colors.textTertiary} />
        <TextInput
          accessibilityLabel="Search contacts"
          value={query}
          onChangeText={setQuery}
          placeholder="Search people, numbers, orgs"
          placeholderTextColor={colors.textTertiary}
          clearButtonMode="never"
          style={[styles.input, !wide && styles.inputPhone, { color: colors.text }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)]}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery("")}>
            <Ionicons name="close-circle" size={15} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      {wide ? <AddPersonButton onPress={onAddContact} /> : null}
    </View>
  );

  const header = wide ? (
    <View>
      {search}
      <View style={[styles.chead, { borderBottomColor: colors.divider }]}>
        <Text accessibilityRole="header" style={[styles.cheadTitle, { color: colors.text, fontFamily: HEADER_FONT }]}>Contacts</Text>
        <Text style={[styles.cheadCount, { color: colors.textTertiary }]}>{total === null ? "" : `${total.toLocaleString("en-US")} ${total === 1 ? "person" : "people"}`}</Text>
      </View>
    </View>
  ) : (
    <View>
      <View style={styles.phoneTop}><AddPersonButton onPress={onAddContact} size={24} /></View>
      <Text accessibilityRole="header" style={[styles.phoneTitle, { color: colors.text, fontFamily: HEADER_FONT }]}>Contacts</Text>
      {search}
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
          ? { backgroundColor: colors.surface, borderColor: colors.dividerStrong, borderWidth: 1 }
          : { backgroundColor: colors.field },
        (hovered || pressed) && { backgroundColor: colors.rowHover },
      ]}
    >
      <Ionicons name="git-merge-outline" size={wide ? 15 : 20} color={colors.icon} />
      <Text style={[styles.suggestText, !wide && styles.suggestTextPhone, { color: colors.text }]}>
        {duplicates.length} possible {duplicates.length === 1 ? "duplicate" : "duplicates"}
      </Text>
      <Text style={[styles.suggestGo, !wide && styles.suggestTextPhone, { color: colors.text }]}>Review</Text>
    </Pressable>
  ) : null;

  return (
    <SafeAreaView edges={wide ? [] : ["top"]} style={[styles.pane, { backgroundColor: colors.sidebar }]}>
      {header}
      {people === undefined ? (
        <ActivityIndicator style={styles.center} />
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            testID="contacts-list-scroll"
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
            ListHeaderComponent={notice}
            contentContainerStyle={[styles.listContent, !wide && styles.listContentPhone]}
            onScrollToIndexFailed={({ averageItemLength, index }) =>
              listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false })}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textTertiary }]}>
                {needle ? `No one matches “${query.trim()}”. Searched names, numbers and organizations.` : "No contacts yet."}
              </Text>
            }
            renderItem={renderRow}
          />
          {!wide && !needle && indexLetters.length > 1 ? (
            <View style={styles.index} accessibilityLabel="Section index">
              {indexLetters.map(({ letter, index }) => (
                <Pressable
                  key={letter}
                  accessibilityRole="button"
                  accessibilityLabel={letter === "★" ? "Favorites" : `Jump to ${letter}`}
                  hitSlop={{ left: 12, right: 6 }}
                  onPress={() => listRef.current?.scrollToIndex({ index, animated: false })}
                >
                  <Text style={[styles.indexLetter, { color: colors.textSecondary }]}>{letter}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

function AddPersonButton({ onPress, size = 18 }: { readonly onPress: () => void; readonly size?: number }) {
  const colors = useSignal();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add contact"
      onPress={onPress}
      hitSlop={6}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.addBtn, (hovered || pressed) && { backgroundColor: colors.rowHover }]}
    >
      <Ionicons name="person-add-outline" size={size} color={colors.icon} />
    </Pressable>
  );
}

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
  const colors = useSignal();
  return (
    <Pressable
      testID="contact-row"
      accessibilityRole="button"
      accessibilityLabel={[title, duplicate ? "possible duplicate" : null, secondary].filter(Boolean).join(", ")}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ hovered, pressed, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) => [
        styles.row,
        !wide && styles.rowPhone,
        (hovered || pressed) && { backgroundColor: colors.rowHover },
        selected && { backgroundColor: colors.rowSelected },
        focused && ({ outlineColor: colors.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: -2 } as object),
      ]}
    >
      {avatar}
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          <Text numberOfLines={1} style={[styles.name, !wide && styles.namePhone, { color: colors.text }]}>{title}</Text>
          {duplicate ? (
            <Text style={[styles.dupTag, { color: colors.textSecondary, borderColor: colors.dividerStrong }]}>Duplicate</Text>
          ) : null}
        </View>
        {secondary ? <Text numberOfLines={1} style={[styles.secondary, !wide && styles.secondaryPhone, { color: colors.textSecondary }]}>{secondary}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  center: { flex: 1, paddingTop: 36 },
  listWrap: { flex: 1, position: "relative" },
  listContent: { paddingBottom: 16, paddingHorizontal: 8 },
  listContentPhone: { paddingHorizontal: 20, paddingRight: 28 },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 4, paddingLeft: 12, paddingRight: 10, paddingTop: 12 },
  searchRowPhone: { paddingHorizontal: 16, paddingTop: 8 },
  field: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 7, height: 30, paddingLeft: 9, paddingRight: 8 },
  fieldPhone: { borderRadius: 12, gap: 10, height: 38, paddingLeft: 14 },
  input: { flex: 1, fontSize: 13, minWidth: 0, paddingVertical: 0 },
  inputPhone: { fontSize: 16 },
  addBtn: { alignItems: "center", borderRadius: 7, height: 30, justifyContent: "center", width: 30 },
  chead: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingBottom: 10, paddingLeft: 16, paddingRight: 14, paddingTop: 12 },
  cheadTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  cheadCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  phoneTop: { alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 4 },
  phoneTitle: { fontSize: 26, fontWeight: "600", letterSpacing: -0.5, paddingHorizontal: 20, paddingTop: 4 },
  suggest: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 10, marginBottom: 4, marginHorizontal: -2, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10 },
  suggestPhone: { borderRadius: 14, gap: 14, marginHorizontal: -4, marginTop: 12, paddingHorizontal: 16, paddingVertical: 12 },
  suggestText: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  suggestTextPhone: { fontSize: 16 },
  suggestGo: { fontSize: 12.5, fontWeight: "600" },
  group: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 6, paddingHorizontal: 10, paddingTop: 14 },
  groupPhone: { paddingHorizontal: 0, paddingTop: 18 },
  groupLabel: { fontSize: 11.5, fontVariant: ["tabular-nums"] },
  groupLabelPhone: { fontSize: 13 },
  row: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 10, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 8 },
  rowPhone: { borderRadius: 14, gap: 14, marginBottom: 0, marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 8 },
  rowText: { flex: 1, minWidth: 0 },
  nameLine: { alignItems: "center", flexDirection: "row", gap: 6 },
  name: { flexShrink: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  namePhone: { fontSize: 16, lineHeight: 21 },
  secondary: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  secondaryPhone: { fontSize: 14, lineHeight: 19 },
  dupTag: { borderRadius: 5, borderWidth: 1, fontSize: 11, fontWeight: "600", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1 },
  dots: { flexDirection: "row", gap: 3 },
  empty: { fontSize: 13, paddingHorizontal: 12, paddingTop: 24, textAlign: "center" },
  index: { alignItems: "center", bottom: 0, justifyContent: "center", position: "absolute", right: 2, top: 0, width: 18 },
  indexLetter: { fontSize: 11, fontWeight: "600", lineHeight: 15 },
});
