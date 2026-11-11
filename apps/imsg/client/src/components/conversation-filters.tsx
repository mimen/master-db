import Ionicons from "@expo/vector-icons/Ionicons";
import type { StateCounts, StateFilter } from "@shared/types";
import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { RollingNumber } from "./motion/rolling-number";
import { Dropdown, type DropdownOption } from "./ui/dropdown";
import { headerFace } from "@/lib/header-font";
import { useTheme } from "@/hooks/use-theme";
import { VIEWS, viewOf, type FilterChip, type InboxView } from "@/lib/inbox-model";
import type { SavedView } from "@/lib/palette/saved-views";

const WEB = Platform.OS === "web";
const NO_SELECT = WEB ? ({ userSelect: "none", cursor: "pointer" } as object) : null;

function formatCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

/** A view's count, or undefined when the view has none or counts are still loading. */
function countOf(view: InboxView, counts: StateCounts | null): number | undefined {
  return view.count ? counts?.[view.id] : undefined;
}

/** A view's count in its own color: a "turn" count above zero is the app badge's, and rolls as it changes. */
function ViewCount({ view, counts, size = "title" }: { readonly view: InboxView; readonly counts: StateCounts | null; readonly size?: "row" | "title" }) {
  const theme = useTheme();
  const count = countOf(view, counts);
  if (!view.count) return null;
  const textStyle = size === "row" ? styles.rowCount : styles.titleCount;
  const turn = view.count === "turn" && (count ?? 0) > 0;
  const color = turn ? theme.turn : theme.textTertiary;
  return (
    // The rolling digits need a box of their own: a margin on their text would land on every digit.
    // Named for assistive tech and tests: the digits alone roll through every value.
    <View aria-label={count === undefined ? undefined : `${view.label}, ${count}`} style={size === "row" ? styles.rowCountBox : null}>
      {count === undefined ? (
        // Counts are unknown until the first list arrives; two digits hold the place so nothing shifts.
        <Text aria-hidden style={[textStyle, styles.countPlaceholder]}>00</Text>
      ) : turn && count <= 999 ? (
        <RollingNumber value={count} style={[textStyle, { color }, styles.turnCount]} />
      ) : (
        <Text style={[textStyle, { color }]}>{formatCount(count)}</Text>
      )}
    </View>
  );
}

interface ViewNavProps {
  readonly state: StateFilter;
  readonly counts: StateCounts | null;
  readonly onSelect: (id: StateFilter) => void;
  readonly phone?: boolean;
}

function menuOptions(views: readonly InboxView[], counts: StateCounts | null): DropdownOption<StateFilter>[] {
  return views.map((view) => {
    const count = countOf(view, counts);
    return { value: view.id, label: view.label, icon: <ViewGlyph view={view} />, trailing: count === undefined ? undefined : formatCount(count) };
  });
}

function ViewGlyph({ view, size = 14 }: { readonly view: InboxView; readonly size?: number }) {
  const theme = useTheme();
  return <Ionicons aria-hidden name={view.icon} size={size} color={theme.icon} style={{ width: size, textAlign: "center" }} />;
}

/** The Messages views: the open view's row opens a menu of every view's row. The phone's menu hangs off the view's name. */
export function ViewNav(props: ViewNavProps) {
  return props.phone ? <ViewMenu {...props} /> : <ViewRowMenu {...props} />;
}

function ViewRow({ view, counts, selected, trailing }: { readonly view: InboxView; readonly counts: StateCounts | null; readonly selected: boolean; readonly trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ViewGlyph view={view} size={15} />
      <Text numberOfLines={1} style={[styles.rowLabel, { color: theme.text }, selected && styles.rowLabelOn]}>{view.label}</Text>
      <ViewCount view={view} counts={counts} size="row" />
      {trailing}
    </View>
  );
}

function ViewRowMenu({ state, counts, onSelect }: ViewNavProps) {
  const theme = useTheme();
  return (
    <View style={styles.list}>
      <Dropdown
        label="View"
        value={state}
        options={menuOptions(VIEWS, counts)}
        onChange={onSelect}
        variant="title"
        style={[styles.rowTrigger, { backgroundColor: theme.rowSelected }]}
        renderTrigger={(current) => current && (
          <ViewRow view={viewOf(current.value)} counts={counts} selected trailing={<Ionicons aria-hidden name="chevron-down" size={12} color={theme.textTertiary} style={styles.rowChevron} />} />
        )}
        renderOption={(option, selected) => <ViewRow view={viewOf(option.value)} counts={counts} selected={selected} trailing={<View style={styles.rowChevron} />} />}
      />
    </View>
  );
}

function ViewMenu({ state, counts, onSelect }: ViewNavProps) {
  const theme = useTheme();
  return (
    <View style={styles.menuPhone}>
      <Dropdown
        label="View"
        value={state}
        options={menuOptions(VIEWS, counts)}
        onChange={onSelect}
        variant="title"
        menuWidth={240}
        renderTrigger={(current) => current && <ViewTitle view={viewOf(current.value)} counts={counts} phone trailing={<Ionicons aria-hidden name="chevron-down" size={16} color={theme.icon} />} />}
      />
    </View>
  );
}

/** A view's name as a heading with its count. The phone's Sidebar list puts it under a back link to the views. */
export function ViewTitle({ view, counts, phone, trailing }: { readonly view: InboxView; readonly counts: StateCounts | null; readonly phone: boolean; readonly trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.title}>
      {/* Wide chrome names the view in its own hidden heading, with the People filter. */}
      <Text accessibilityRole={phone ? "header" : undefined} numberOfLines={1} style={[phone ? styles.titleTextPhone : styles.titleText, { color: theme.text }]}>{view.title ?? view.label}</Text>
      <ViewCount view={view} counts={counts} />
      {trailing}
    </View>
  );
}

/** Saved views, then the active filter chips, then Clear all. Phone puts the count line first. */
export function FilterChipRow({
  chips,
  views,
  onRemove,
  onClearAll,
  onOpenView,
  onDeleteView,
  countLine,
  phone = false,
}: {
  chips: FilterChip[];
  views: readonly SavedView[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
  onOpenView: (view: SavedView) => void;
  onDeleteView: (view: SavedView) => void;
  countLine?: string;
  phone?: boolean;
}) {
  const theme = useTheme();
  if (chips.length === 0 && views.length === 0) return null;
  const clearAll = chips.length > 0 ? (
    <Pressable accessibilityRole="button" onPress={onClearAll} hitSlop={6} style={NO_SELECT}>
      <Text style={[styles.clearAll, { color: theme.textSecondary }]}>Clear all</Text>
    </Pressable>
  ) : null;
  const chipViews = (
    <>
      {views.map((view) => (
        <View key={view.id} style={[styles.chip, styles.viewChip, { backgroundColor: theme.chipBg, borderColor: theme.chipBorder }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open view ${view.name}`} onPress={() => onOpenView(view)} style={[styles.chipBody, NO_SELECT]}>
            <Ionicons aria-hidden name="bookmark-outline" size={11} color={theme.icon} />
            <Text numberOfLines={1} style={[styles.chipLabel, { color: theme.text }]}>{view.name}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete view ${view.name}`} onPress={() => onDeleteView(view)} hitSlop={6} style={[styles.chipX, NO_SELECT]}>
            <Ionicons aria-hidden name="close" size={11} color={theme.icon} />
          </Pressable>
        </View>
      ))}
      {chips.map((chip) => (
        <View key={chip.key} style={[styles.chip, phone && styles.chipPhone, { backgroundColor: theme.chipBg, borderColor: theme.chipBorder }]}>
          <Text numberOfLines={1} style={[styles.chipLabel, phone && styles.chipLabelPhone, { color: theme.text }]}>
            {chip.prefix ? <Text style={{ color: theme.textSecondary, fontWeight: "400" }}>{chip.prefix} </Text> : null}
            {chip.label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove filter ${chip.prefix ? `${chip.prefix} ` : ""}${chip.label}`}
            onPress={() => onRemove(chip)}
            hitSlop={6}
            style={[styles.chipX, NO_SELECT]}
          >
            <Ionicons aria-hidden name="close" size={phone ? 14 : 11} color={theme.icon} />
          </Pressable>
        </View>
      ))}
    </>
  );
  if (phone) {
    return (
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsPhone}>{chipViews}</ScrollView>
        {countLine ? (
          <View style={styles.countLine}>
            <Text style={[styles.countLineText, { color: theme.textSecondary }]}>{countLine}</Text>
            {clearAll}
          </View>
        ) : null}
      </View>
    );
  }
  return <View style={styles.chips}>{chipViews}{clearAll}</View>;
}

const styles = StyleSheet.create({
  turnCount: { fontWeight: "600" },
  countPlaceholder: { opacity: 0 },
  list: { paddingBottom: 6, paddingHorizontal: 6, paddingTop: 2 },
  row: { alignItems: "center", flexGrow: 1, flexDirection: "row", gap: 9, height: 28, paddingHorizontal: 8 },
  rowLabel: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  rowLabelOn: { fontWeight: "600" },
  rowCount: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 16 },
  rowCountBox: { alignItems: "flex-end", minWidth: 24 },
  rowChevron: { width: 12 },
  rowTrigger: { alignSelf: "stretch", flexShrink: 0, minHeight: 0, paddingHorizontal: 0, borderRadius: 7 },
  menuPhone: { alignItems: "flex-start", paddingHorizontal: 14 },
  title: { alignItems: "baseline", flexDirection: "row", flexShrink: 1, gap: 6 },
  titleText: { ...headerFace, flexShrink: 1, fontSize: 17, letterSpacing: -0.3 },
  titleTextPhone: { ...headerFace, flexShrink: 1, fontSize: 30, letterSpacing: -0.6, lineHeight: 36 },
  titleCount: { fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 18 },
  chips: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 2, paddingLeft: 14, paddingRight: 12, paddingTop: 10 },
  chipsPhone: { gap: 8, paddingHorizontal: 20, paddingTop: 8 },
  chip: { alignItems: "center", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, height: 24, paddingLeft: 9, paddingRight: 4 },
  chipPhone: { height: 32, paddingLeft: 12, paddingRight: 8 },
  viewChip: { paddingLeft: 7 },
  chipBody: { alignItems: "center", flexDirection: "row", gap: 4 },
  chipLabel: { fontSize: 12, fontWeight: "500", maxWidth: 180 },
  chipLabelPhone: { fontSize: 15 },
  chipX: { alignItems: "center", borderRadius: 8, height: 16, justifyContent: "center", width: 16 },
  clearAll: { fontSize: 12, fontWeight: "500", marginLeft: 4 },
  countLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 10 },
  countLineText: { fontSize: 13, fontVariant: ["tabular-nums"] },
});
