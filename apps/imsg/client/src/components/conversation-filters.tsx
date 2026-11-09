import Ionicons from "@expo/vector-icons/Ionicons";
import type { StateCounts, StateFilter } from "@shared/types";
import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LiquidTabs } from "./motion/liquid-tabs";
import { RollingNumber } from "./motion/rolling-number";
import { Dropdown, type DropdownOption } from "./ui/dropdown";
import { headerFace } from "@/lib/header-font";
import { useTheme } from "@/hooks/use-theme";
import { viewOf, viewOrder, viewShortcut, type FilterChip, type InboxView, type NavStyle } from "@/lib/inbox-model";
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

function spoken(view: InboxView, counts: StateCounts | null): string {
  const count = countOf(view, counts);
  return count === undefined ? view.label : `${view.label}, ${count}`;
}

/** A view's count in its own color: a "turn" count above zero is the app badge's, and rolls as it changes. */
function ViewCount({ view, counts, size }: { readonly view: InboxView; readonly counts: StateCounts | null; readonly size: "tab" | "row" | "title" }) {
  const theme = useTheme();
  const count = countOf(view, counts);
  if (!view.count) return null;
  const textStyle = size === "tab" ? styles.tabCount : size === "title" ? styles.titleCount : styles.rowCount;
  const turn = view.count === "turn" && (count ?? 0) > 0;
  const color = turn ? theme.turn : theme.textTertiary;
  return (
    // The rolling digits need a box of their own: a margin on their text would land on every digit.
    <View style={size === "tab" ? styles.tabCountBox : size === "row" ? styles.rowCountBox : null}>
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
  readonly style: NavStyle;
  readonly state: StateFilter;
  readonly counts: StateCounts | null;
  readonly onSelect: (id: StateFilter) => void;
  readonly phone?: boolean;
}

/** The Messages views in the style Settings picks. Every style reads VIEWS, so a new view shows up in all three. */
export function ViewNav({ style, ...props }: ViewNavProps) {
  if (style === "tabs") return <ViewTabs {...props} />;
  if (style === "compact") return <ViewMenu {...props} />;
  return <ViewList {...props} />;
}

/** The Tabs style: the primary views as tabs, then More with the rest. A view picked from More takes More's place. */
function ViewTabs({ state, counts, onSelect, phone = false }: Omit<ViewNavProps, "style">) {
  const theme = useTheme();
  const order = viewOrder("tabs");
  const primary = order.filter((view) => view.primary);
  const more = order.filter((view) => !view.primary);
  const inMore = more.some((view) => view.id === state);
  const tabs = primary.map((view) => ({
    key: view.id,
    label: view.label,
    accessibilityLabel: spoken(view, counts),
    accessibilityHint: WEB && !phone ? viewShortcut("tabs", view.id) : undefined,
  }));
  const row = (
    <View style={[styles.tabsRow, phone && styles.tabsRowPhone]}>
      <LiquidTabs
        tabs={tabs}
        // A view under More has no tab; the bar rests under nothing.
        value={state}
        onChange={onSelect}
        style={phone ? styles.tabsPhone : styles.tabs}
        renderLabel={(tab, color) => (
          <>
            <Text numberOfLines={1} style={[phone ? styles.tabLabelPhone : styles.tabLabel, { color }]}>{tab.label}</Text>
            <ViewCount view={viewOf(tab.key)} counts={counts} size="tab" />
          </>
        )}
      />
      <Dropdown
        label="More views"
        value={state}
        options={menuOptions(more, counts)}
        onChange={onSelect}
        variant="chip"
        menuWidth={220}
        style={styles.more}
        renderTrigger={(current) => (
          <View style={[styles.moreBody, inMore && { borderBottomColor: theme.lensBar }]}>
            <Text numberOfLines={1} style={[phone ? styles.tabLabelPhone : styles.tabLabel, { color: inMore ? theme.text : theme.textTertiary }]}>
              {current?.label ?? "More"}
            </Text>
            <Ionicons aria-hidden name="chevron-down" size={11} color={inMore ? theme.text : theme.textTertiary} />
          </View>
        )}
      />
    </View>
  );
  // A sidebar dragged narrow scrolls the row rather than pushing the pane sideways.
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={phone ? null : styles.tabsScroll}>{row}</ScrollView>;
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

/** The Sidebar list style: every view on its own row, glyph, name and a right-aligned count, as in Mail or Linear. */
export function ViewList({ state, counts, onSelect, phone = false }: Omit<ViewNavProps, "style">) {
  const theme = useTheme();
  return (
    <View role="tablist" aria-orientation="vertical" style={phone ? styles.listPhone : styles.list}>
      {viewOrder("list").map((view) => {
        const selected = view.id === state;
        return (
          <Pressable
            key={view.id}
            role="tab"
            aria-selected={selected}
            accessibilityState={{ selected }}
            accessibilityLabel={spoken(view, counts)}
            accessibilityHint={WEB && !phone ? viewShortcut("list", view.id) : undefined}
            onPress={() => onSelect(view.id)}
            style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => [
              phone ? styles.rowPhone : styles.row,
              NO_SELECT,
              (hovered || pressed) && { backgroundColor: theme.rowHover },
              selected && { backgroundColor: theme.rowSelected },
            ]}
          >
            <ViewGlyph view={view} size={phone ? 20 : 15} />
            <Text numberOfLines={1} style={[phone ? styles.rowLabelPhone : styles.rowLabel, { color: theme.text }, selected && styles.rowLabelOn]}>{view.label}</Text>
            <ViewCount view={view} counts={counts} size="row" />
            {phone ? <Ionicons aria-hidden name="chevron-forward" size={15} color={theme.textTertiary} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The Compact style: the view's name is the heading, and a menu of every view. */
function ViewMenu({ state, counts, onSelect, phone = false }: Omit<ViewNavProps, "style">) {
  const theme = useTheme();
  const order = viewOrder("compact");
  return (
    <View style={phone ? styles.menuPhone : styles.menu}>
      <Dropdown
        label="View"
        value={state}
        options={menuOptions(order, counts)}
        onChange={onSelect}
        variant="title"
        menuWidth={240}
        renderTrigger={(current) => current && <ViewTitle view={viewOf(current.value)} counts={counts} phone={phone} trailing={<Ionicons aria-hidden name="chevron-down" size={phone ? 16 : 12} color={theme.icon} />} />}
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
      <ViewCount view={view} counts={counts} size="title" />
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
  tabsRow: { alignItems: "flex-end", flexDirection: "row", gap: 14 },
  tabsScroll: { flexGrow: 1 },
  tabs: { gap: 14 },
  tabsRowPhone: { paddingHorizontal: 20 },
  tabsPhone: { gap: 14 },
  tabLabel: { ...headerFace, fontSize: 14, letterSpacing: -0.15, lineHeight: 18 },
  tabLabelPhone: { ...headerFace, fontSize: 15, letterSpacing: -0.2, lineHeight: 20 },
  // The count sits 4 px after its own label and 14 px before the next tab, so it never reads as the next one's.
  tabCount: { fontSize: 11.5, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 18 },
  tabCountBox: { alignSelf: "flex-start", marginLeft: 4 },
  turnCount: { fontWeight: "600" },
  countPlaceholder: { opacity: 0 },
  more: { minHeight: 0, paddingHorizontal: 0 },
  moreBody: { alignItems: "center", borderBottomColor: "transparent", borderBottomWidth: 2, flexDirection: "row", gap: 4, paddingBottom: 8 },
  list: { paddingBottom: 6, paddingHorizontal: 6, paddingTop: 2 },
  listPhone: { paddingHorizontal: 8, paddingTop: 4 },
  row: { alignItems: "center", borderRadius: 7, flexDirection: "row", gap: 9, height: 28, paddingHorizontal: 8 },
  rowPhone: { alignItems: "center", borderRadius: 12, flexDirection: "row", gap: 12, minHeight: 48, paddingHorizontal: 12 },
  rowLabel: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  rowLabelPhone: { flex: 1, fontSize: 17 },
  rowLabelOn: { fontWeight: "600" },
  rowCount: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 16 },
  rowCountBox: { alignItems: "flex-end", minWidth: 24 },
  menu: { alignItems: "flex-start", paddingBottom: 6, paddingHorizontal: 8 },
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
