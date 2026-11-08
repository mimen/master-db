import Ionicons from "@expo/vector-icons/Ionicons";
import type { StateCounts, StateFilter } from "@shared/types";
import { useEffect, useRef } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LiquidTabs } from "./motion/liquid-tabs";
import { RollingNumber } from "./motion/rolling-number";
import { headerFace } from "@/lib/header-font";
import { useTheme } from "@/hooks/use-theme";
import { LENSES, lensOf, type FilterChip, type Lens } from "@/lib/inbox-model";
import type { SavedView } from "@/lib/palette/saved-views";

const WEB = Platform.OS === "web";
const NO_SELECT = WEB ? ({ userSelect: "none", cursor: "pointer" } as object) : null;

function formatCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

/**
 * The lens tab row, the app's only segmented control. Needs you carries a turn-colored count,
 * Unread and Agents gray ones. The row scrolls sideways when the sidebar is too narrow for all seven;
 * on the phone the tabs are the page title, without the bar.
 */
export function LensTabs({
  state,
  counts,
  onSelect,
  phone = false,
}: {
  state: StateFilter;
  counts: StateCounts | null;
  onSelect: (lens: Lens) => void;
  phone?: boolean;
}) {
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);
  // The tab picked, by click or ⌘1-7, is scrolled into view: Agents sits past the right edge when it overflows.
  // The phone's row is far wider than the screen and keeps the user's own scroll.
  useEffect(() => {
    if (phone) return;
    if (state === "agents") scroller.current?.scrollToEnd({ animated: true });
    else scroller.current?.scrollTo({ x: 0, animated: true });
  }, [phone, state]);
  const tabs = LENSES.map((lens, index) => {
    const count = lens.count ? counts?.[lens.value] : undefined;
    return {
      key: lens.value,
      label: lens.label,
      accessibilityLabel: count === undefined ? lens.label : `${lens.label}, ${count}`,
      accessibilityHint: WEB && !phone ? `Command ${index + 1}` : undefined,
    };
  });
  const row = (
    <LiquidTabs
      tabs={tabs}
      // Settled has no tab; the bar rests under nothing.
      value={lensOf(state) ?? ("settled" as Lens)}
      onChange={onSelect}
      underline={!phone}
      style={phone ? styles.tabsPhone : styles.tabs}
      tabStyle={phone ? styles.tabPhone : null}
      renderLabel={(tab, color) => {
        const lens = LENSES.find((l) => l.value === tab.key)!;
        const count = lens.count ? counts?.[lens.value] : undefined;
        const turnCount = lens.count === "turn" && (count ?? 0) > 0;
        // The sparkle's count hugs it; word tabs right-align theirs in a two-digit slot.
        const slot = lens.value === "agents" ? styles.sparkleCount : styles.countSlot;
        return (
          <>
            {lens.value === "agents" ? (
              // The mark agent drafts carry in rows.
              <Ionicons aria-hidden name="sparkles" size={phone ? 24 : 14} color={color} style={phone ? styles.sparklePhone : styles.sparkle} />
            ) : (
              <Text numberOfLines={1} style={[phone ? styles.tabLabelPhone : styles.tabLabel, { color }]}>{tab.label}</Text>
            )}
            {lens.count && count === undefined ? (
              // Counts are unknown until the first list arrives; two digits hold their place.
              <Text aria-hidden style={[phone ? styles.tabCountPhone : styles.tabCount, slot, styles.countPlaceholder]}>00</Text>
            ) : count === undefined ? null : lens.count === "turn" && count <= 999 ? (
              // The Needs you count is the app badge; it rolls on snappy as it changes.
              <View style={[phone ? styles.rollPhone : styles.roll, styles.countSlot]}>
                <RollingNumber value={count} style={[phone ? styles.tabCountPhone : styles.tabCount, styles.rollText, { color: turnCount ? theme.turn : theme.textTertiary }, turnCount && styles.tabCountTurn]} />
              </View>
            ) : (
              <Text style={[phone ? styles.tabCountPhone : styles.tabCount, slot, { color: theme.textTertiary }]}>{formatCount(count)}</Text>
            )}
          </>
        );
      }}
    />
  );
  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={phone ? null : styles.tabsScroll}>{row}</ScrollView>
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
  // space-between spreads the tabs across a wide sidebar; a narrow one scrolls instead of squeezing them.
  tabs: { flexGrow: 1, gap: 6, justifyContent: "space-between" },
  tabsScroll: { flexGrow: 1 },
  tabsPhone: { gap: 22, paddingHorizontal: 20 },
  tabPhone: { paddingBottom: 6 },
  tabLabel: { ...headerFace, fontSize: 14.5, letterSpacing: -0.15, lineHeight: 18 },
  tabLabelPhone: { ...headerFace, fontSize: 26, letterSpacing: -0.5, lineHeight: 32 },
  tabCount: { fontSize: 11.5, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 18, marginLeft: 5 },
  tabCountPhone: { alignSelf: "flex-start", fontSize: 13, lineHeight: 16, fontVariant: ["tabular-nums"], fontWeight: "500", marginLeft: 3, marginTop: 2 },
  tabCountTurn: { fontWeight: "600" },
  // A fixed box: the icon font can land after first paint, and a fallback glyph's width would move the row.
  sparkle: { lineHeight: 18, textAlign: "center", width: 14 },
  sparkleCount: { marginLeft: 3, minWidth: "2ch", textAlign: "left" } as object,
  sparklePhone: { lineHeight: 32, textAlign: "center", width: 24 },
  countPlaceholder: { opacity: 0 },
  // Two tabular digits wide at any count under 100, so 8 to 16 to 44 while pages load never moves the tabs.
  countSlot: { minWidth: "2ch", alignItems: "flex-end", textAlign: "right" } as object,
  roll: { alignSelf: "flex-start", marginLeft: 5 },
  rollPhone: { alignSelf: "flex-start", marginLeft: 3, marginTop: 2 },
  rollText: { alignSelf: "auto", marginLeft: 0, marginTop: 0 },
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
