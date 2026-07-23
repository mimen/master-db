import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { avatarUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import { type AirtableHumanRow, type ContactListRow, primaryHandle } from "@/lib/identity";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { useAiStatus } from "@/hooks/use-ai";
import { useTheme } from "@/hooks/use-theme";
import { useActionSheet } from "@/lib/action-sheet";
import { setSuggestionMode, useSuggestionMode, type SuggestionMode } from "@/lib/settings";
import { SIDEBAR_CHROME_HEIGHT } from "./conversation-list-pane";
import { NavSwitcher } from "./nav-switcher";

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
 * Contacts list — desktop mirrors the Messages pane exactly: same frosted
 * fixed top bar (toggle + the same icon set), search riding the scroll in the
 * same spot, list below. Mobile keeps its simple title layout (bottom tabs).
 */
export function ContactsListPane({ wide, selectedId, onSelectPerson }: ContactsListPaneProps) {
  const theme = useTheme();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();
  const suggestionMode = useSuggestionMode();
  const [query, setQuery] = useState("");
  const topBarH = SIDEBAR_CHROME_HEIGHT;
  const [contentH, setContentH] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const scrollYAnim = useRef(new Animated.Value(0)).current;
  const aiBtnRef = useRef<View>(null);
  const needle = query.trim().toLowerCase();

  const glassStyle =
    Platform.OS === "web"
      ? ({
          backgroundColor: `${theme.background}E6`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottomColor: theme.divider,
          borderBottomWidth: StyleSheet.hairlineWidth,
        } as object)
      : { backgroundColor: theme.background };

  const openSuggestionSettings = (): void => {
    const options: Array<{ label: string; mode: SuggestionMode }> = [
      { label: "Off", mode: "off" },
      { label: "On demand", mode: "on-demand" },
      { label: "Automatic", mode: "auto" },
    ];
    const show = (anchor?: { x: number; y: number }) =>
      showSheet({
        title: "Reply suggestions",
        actions: options.map((o) => ({
          label: `${suggestionMode === o.mode ? "✓  " : "    "}${o.label}`,
          onPress: () => setSuggestionMode(o.mode),
        })),
        anchor,
      });
    if (wide && aiBtnRef.current) {
      aiBtnRef.current.measureInWindow((x, y, _w, h) => show({ x, y: y + h + 4 }));
    } else {
      show();
    }
  };

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

  const searchField = (
    <View
      style={[
        styles.searchField,
        !wide && styles.searchFieldInline,
        { backgroundColor: theme.backgroundElement },
      ]}
    >
      <Ionicons name="search" size={17} color={theme.textSecondary} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor={theme.textSecondary}
        style={[styles.searchInput, { color: theme.text }]}
      />
      {needle.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => setQuery("")}
          hitSlop={8}
        >
          <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
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
            <Ionicons name="add-circle-outline" size={22} color="#0A84FF" />
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

  // Synthetic scrollbar identical to the Messages pane: starts below the glass
  // bar, thin track-less thumb.
  const trackH = Math.max(0, viewportH - topBarH - 6);
  const showThumb = viewportH > 0 && contentH > viewportH + 4;
  const thumbH = showThumb ? Math.max(36, (trackH * viewportH) / contentH) : 0;
  const thumbTranslate = scrollYAnim.interpolate({
    inputRange: [0, Math.max(1, contentH - viewportH)],
    outputRange: [0, Math.max(0, trackH - thumbH)],
    extrapolate: "clamp",
  });

  return (
    <SafeAreaView style={[styles.pane, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={styles.listWrap}>
          {people === undefined ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(r) => r.key}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 12, paddingTop: topBarH + 8 }}
              onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
              onContentSizeChange={(_w, h) => setContentH(h)}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollYAnim } } }], {
                useNativeDriver: false,
              })}
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
          {showThumb && (
            <Animated.View
              pointerEvents="none"
              style={[styles.scrollThumb, { top: topBarH, height: thumbH, transform: [{ translateY: thumbTranslate }] }]}
            />
          )}
          {/* Frosted top bar — identical chrome to the Messages pane. */}
          <View style={[styles.topBar, glassStyle]}>
            {wide ? <NavSwitcher active="contacts" style={styles.navInline} /> : searchField}
            <View style={styles.titleActions}>
              {aiStatus?.suggestions && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Suggestion settings"
                  ref={aiBtnRef}
                  onPress={openSuggestionSettings}
                  style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
                >
                  <Ionicons name="sparkles-outline" size={20} color={theme.accent} />
                </Pressable>
              )}
              {/* Filters are a Messages concept — present for bar parity, inert here. */}
              <View style={[styles.titleButton, { opacity: 0.3 }]}>
                <Ionicons name="options-outline" size={21} color={theme.accent} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New message"
                onPress={() => router.push("/new-chat")}
                style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
              >
                <Ionicons name="create-outline" size={23} color={theme.accent} />
              </Pressable>
            </View>
          </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  listWrap: { flex: 1, position: "relative" },
  scrollThumb: {
    backgroundColor: "rgba(140,140,150,0.5)",
    borderRadius: 3,
    position: "absolute",
    right: 2,
    width: 6,
    zIndex: 5,
  },
  center: { alignItems: "center", flex: 1, justifyContent: "center", paddingTop: 36 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    height: 58,
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  navInline: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  titleActions: {
    flexDirection: "row",
    gap: 2,
  },
  titleButton: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.1,
    paddingLeft: 6,
  },
  searchField: {
    alignItems: "center",
    borderRadius: 11,
    flexDirection: "row",
    gap: 8,
    height: 38,
    marginBottom: 12,
    marginHorizontal: 18,
    marginTop: 4,
    paddingHorizontal: 12,
  },
  searchFieldInline: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
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
