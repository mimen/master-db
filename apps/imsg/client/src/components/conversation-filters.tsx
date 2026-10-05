import { Ionicons } from "@expo/vector-icons";
import type { StateCounts, StateFilter, TypeFilter } from "@shared/types";
import { useEffect } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { Dropdown, type DropdownOption } from "./ui/dropdown";
import { LiquidTabs } from "./motion/liquid-tabs";
import { RollingNumber } from "./motion/rolling-number";
import { Springs } from "@/constants/springs";
import { headerFace } from "@/lib/header-font";
import { useTheme } from "@/hooks/use-theme";

type ThemeColors = ReturnType<typeof useTheme>;
import {
  INCLUDE_LABELS,
  LENSES,
  lensOf,
  ONLY_LABELS,
  PEOPLE_LABELS,
  PEOPLE_ORDER,
  PRIORITY_LABELS,
  SERVICE_LABELS,
  TIME_LABELS,
  toggled,
  type FilterChip,
  type IncludeKey,
  type Lens,
  type OnlyKey,
  type PriorityLevel,
  type Refinements,
  type Service,
  type TimeRange,
} from "@/lib/inbox-model";
import type { SavedView } from "@/lib/palette/saved-views";

const WEB = Platform.OS === "web";
const NO_SELECT = WEB ? ({ userSelect: "none", cursor: "pointer" } as object) : null;

function formatCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

/**
 * The lens tab row, the app's only segmented control. Needs reply carries a turn-colored count,
 * Unread a gray one. On the phone the tabs are the page title and scroll sideways, without the bar.
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
        return (
          <>
            <Text numberOfLines={1} style={[phone ? styles.tabLabelPhone : styles.tabLabel, { color }]}>{tab.label}</Text>
            {count === undefined ? null : lens.count === "turn" && count <= 999 ? (
              // The Needs reply count is the app badge; it rolls on snappy as it changes.
              <View style={phone ? styles.rollPhone : styles.roll}>
                <RollingNumber value={count} style={[phone ? styles.tabCountPhone : styles.tabCount, styles.rollText, { color: turnCount ? theme.turn : theme.textTertiary }, turnCount && styles.tabCountTurn]} />
              </View>
            ) : (
              <Text style={[phone ? styles.tabCountPhone : styles.tabCount, { color: theme.textTertiary }]}>{formatCount(count)}</Text>
            )}
          </>
        );
      }}
    />
  );
  return phone ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>{row}</ScrollView>
  ) : row;
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

/** A labeled row around the shared dropdown: a form row in the popover, a settings row on the sheet. */
function Field<V extends string>({
  label,
  icon,
  phone,
  ...dropdown
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  phone: boolean;
  value: V;
  options: readonly DropdownOption<V>[];
  onChange: (value: V) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[phone ? [styles.sheetRow, { borderBottomColor: theme.divider }] : styles.fieldRow]}>
      {phone ? <Ionicons aria-hidden name={icon} size={20} color={theme.icon} style={styles.sheetIcon} /> : null}
      <Text style={[phone ? styles.sheetLabel : styles.fieldLabel, { color: phone ? theme.text : theme.textSecondary }]}>{label}</Text>
      <Dropdown label={label} {...dropdown} style={phone ? styles.sheetField : styles.field} />
    </View>
  );
}

function Toggle({
  label,
  icon,
  count,
  checked,
  onToggle,
  phone,
  theme,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  checked: boolean;
  onToggle: () => void;
  phone: boolean;
  theme: ThemeColors;
}) {
  if (phone) {
    return (
      <View style={[styles.sheetRow, { borderBottomColor: theme.divider }]}>
        <Ionicons aria-hidden name={icon} size={20} color={theme.icon} style={styles.sheetIcon} />
        <Text style={[styles.sheetLabel, { color: theme.text }]}>{label}</Text>
        <Switch
          accessibilityLabel={`${label}, ${count}`}
          value={checked}
          onValueChange={onToggle}
          trackColor={{ false: theme.switchOff, true: theme.switchOn }}
          thumbColor="#FFFFFF"
        />
      </View>
    );
  }
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      accessibilityLabel={`${label}, ${count}`}
      onPress={onToggle}
      style={[styles.check, NO_SELECT]}
    >
      <View style={[styles.box, checked ? { backgroundColor: theme.switchOn, borderColor: theme.switchOn } : { borderColor: theme.switchOff }]}>
        {checked ? <Ionicons aria-hidden name="checkmark" size={12} color={theme.background} /> : null}
      </View>
      <Ionicons aria-hidden name={icon} size={15} color={theme.icon} />
      <Text style={[styles.checkLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.checkCount, { color: theme.textTertiary }]}>{count}</Text>
    </Pressable>
  );
}

const ONLY_ICONS: Record<OnlyKey, keyof typeof Ionicons.glyphMap> = {
  attachments: "attach-outline",
  links: "link-outline",
  pinned: "pin-outline",
  favorites: "star-outline",
};
const INCLUDE_ICONS: Record<IncludeKey, keyof typeof Ionicons.glyphMap> = {
  settled: "checkmark-circle-outline",
  scheduled: "time-outline",
};
const ONLY_KEYS: OnlyKey[] = ["attachments", "links", "pinned", "favorites"];
const INCLUDE_KEYS: IncludeKey[] = ["settled", "scheduled"];
const SERVICES: Service[] = ["any", "iMessage", "SMS"];
const TIMES: TimeRange[] = ["any", "today", "week", "month"];
const PRIORITIES: PriorityLevel[] = ["any", "high", "medium", "low"];
const ANY_TAG = "";

export interface FilterPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Desktop: a popover anchored under the filter icon. Absent: the phone bottom sheet. */
  anchor: { x: number; y: number; width: number; height: number } | null;
  type: TypeFilter;
  refinements: Refinements;
  onTypeChange: (type: TypeFilter) => void;
  onRefinementsChange: (refinements: Refinements) => void;
  onClearAll: () => void;
  onSaveView: () => void;
  tags: readonly string[];
  counts: Record<OnlyKey | IncludeKey, number>;
  showing: number;
  total: number;
  lensLabel: string;
}

/** The filter controls, as the desktop popover or the phone sheet. Every change applies live. */
export function ConversationFiltersPanel(props: FilterPanelProps) {
  const { visible, onClose, anchor, type, refinements: r, onRefinementsChange, counts } = props;
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const phone = anchor === null;
  const scale = useSharedValue(0.98);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!visible) {
      scale.value = 0.98;
      opacity.value = 0;
      return;
    }
    scale.value = reduceMotion ? 1 : withSpring(1, Springs.snappy);
    opacity.value = reduceMotion ? 1 : withSpring(1, Springs.snappy);
  }, [visible, reduceMotion, scale, opacity]);
  const grow = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  const set = (patch: Partial<Refinements>) => onRefinementsChange({ ...r, ...patch });
  const controls = (
    <View style={[phone ? [styles.sheetCard, { backgroundColor: theme.surface, borderColor: theme.divider }] : [styles.band, { borderBottomColor: theme.divider }], styles.raised]}>
      <Field label="People" icon="people-outline" phone={phone} value={type}
        options={PEOPLE_ORDER.map((value) => ({ value, label: PEOPLE_LABELS[value] }))}
        onChange={props.onTypeChange} />
      <Field label="Service" icon="chatbubble-outline" phone={phone} value={r.service}
        options={SERVICES.map((value) => ({ value, label: SERVICE_LABELS[value], dot: value === "iMessage" ? theme.accent : value === "SMS" ? theme.sms : undefined }))}
        onChange={(service) => set({ service })} />
      <Field label="Time" icon="time-outline" phone={phone} value={r.time}
        options={TIMES.map((value) => ({ value, label: TIME_LABELS[value] }))}
        onChange={(time) => set({ time })} />
      <Field label="Priority" icon="star-outline" phone={phone} value={r.priority}
        options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
        onChange={(priority) => set({ priority })} />
      {/* The shared dropdown picks one value, so Tags narrows to a single tag. */}
      <Field label="Tags" icon="pricetag-outline" phone={phone} value={r.tags[0] ?? ANY_TAG}
        options={[{ value: ANY_TAG, label: "Any tag" }, ...props.tags.map((value) => ({ value, label: value }))]}
        onChange={(tag) => set({ tags: tag === ANY_TAG ? [] : [tag] })} />
    </View>
  );
  const toggles = (title: string, keys: readonly (OnlyKey | IncludeKey)[]) => (
    <View style={phone ? null : [styles.band, { borderBottomColor: theme.divider }]}>
      <Text style={[phone ? styles.sheetGroup : styles.bandTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={phone ? [styles.sheetCard, { backgroundColor: theme.surface, borderColor: theme.divider }] : null}>
        {keys.map((key) => {
          const only = (ONLY_KEYS as readonly string[]).includes(key);
          const checked = only ? r.only.includes(key as OnlyKey) : r.include.includes(key as IncludeKey);
          return (
            <Toggle
              key={key}
              theme={theme}
              phone={phone}
              label={only ? ONLY_LABELS[key as OnlyKey] : phone && key === "scheduled" ? "Scheduled" : INCLUDE_LABELS[key as IncludeKey]}
              icon={only ? ONLY_ICONS[key as OnlyKey] : INCLUDE_ICONS[key as IncludeKey]}
              count={counts[key]}
              checked={checked}
              onToggle={() => (only ? set({ only: toggled(r.only, key as OnlyKey) }) : set({ include: toggled(r.include, key as IncludeKey) }))}
            />
          );
        })}
      </View>
    </View>
  );

  if (anchor) {
    const width = Math.min(380, windowWidth - 16);
    const left = Math.max(8, Math.min(anchor.x, windowWidth - width - 8));
    return (
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} style={StyleSheet.absoluteFill} />
        <Reanimated.View
          role="dialog"
          aria-label="Filter conversations"
          style={[styles.popover, { top: anchor.y + anchor.height + 6, left, width, backgroundColor: theme.popBg }, WEB && ({ boxShadow: theme.popShadow, transformOrigin: "top left" } as object), grow]}
        >
          <View style={[styles.popHeader, { borderBottomColor: theme.divider }]}>
            <Text style={[styles.popTitle, { color: theme.text }]}>Filter</Text>
            <Text style={[styles.popCount, { color: theme.textSecondary }]}>Showing {props.showing} of {props.total} in {props.lensLabel}</Text>
          </View>
          {controls}
          {toggles("Only show", ONLY_KEYS)}
          {toggles("Also include", INCLUDE_KEYS)}
          <View style={styles.popFooter}>
            <Pressable accessibilityRole="button" onPress={props.onClearAll} hitSlop={6} style={NO_SELECT}>
              <Text style={[styles.footerClear, { color: theme.textSecondary }]}>Clear all</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={props.onSaveView}
              style={({ hovered }) => [styles.saveView, { borderColor: theme.dividerStrong }, hovered && { backgroundColor: theme.rowHover }, NO_SELECT]}
            >
              <Ionicons aria-hidden name="bookmark-outline" size={14} color={theme.text} />
              <Text style={[styles.saveLabel, { color: theme.text }]}>Save as view</Text>
            </Pressable>
          </View>
        </Reanimated.View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: theme.backdrop }]} />
      <View role="dialog" aria-label="Filter conversations" style={[styles.sheet, { backgroundColor: theme.popBg }]}>
        <View style={[styles.grabber, { backgroundColor: theme.dividerStrong }]} />
        <View style={styles.sheetHeader}>
          <Pressable accessibilityRole="button" onPress={props.onClearAll} hitSlop={8} style={NO_SELECT}>
            <Text style={[styles.sheetAction, { color: theme.textSecondary }]}>Clear</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Filter</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={NO_SELECT}>
            <Text style={[styles.sheetAction, styles.sheetDone, { color: theme.text }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          {controls}
          {toggles("Only show", ONLY_KEYS)}
          {toggles("Also include", INCLUDE_KEYS)}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={[styles.showButton, { backgroundColor: theme.switchOn }]}>
          <Text style={[styles.showLabel, { color: theme.background }]}>
            Show {props.showing} {props.showing === 1 ? "conversation" : "conversations"}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: 14 },
  tabsPhone: { gap: 22, paddingHorizontal: 20 },
  tabPhone: { paddingBottom: 6 },
  tabLabel: { ...headerFace, fontSize: 14.5, letterSpacing: -0.15, lineHeight: 18 },
  tabLabelPhone: { ...headerFace, fontSize: 26, letterSpacing: -0.5, lineHeight: 32 },
  tabCount: { fontSize: 11.5, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 18, marginLeft: 5 },
  tabCountPhone: { alignSelf: "flex-start", fontSize: 13, lineHeight: 16, fontVariant: ["tabular-nums"], fontWeight: "500", marginLeft: 3, marginTop: 2 },
  tabCountTurn: { fontWeight: "600" },
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
  popover: { borderRadius: 14, position: "absolute" },
  popHeader: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 46, justifyContent: "space-between", paddingHorizontal: 16 },
  popTitle: { fontSize: 14, fontWeight: "600" },
  popCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  raised: { position: "relative", zIndex: 2 },
  band: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10 },
  bandTitle: { fontSize: 12, fontWeight: "600", paddingBottom: 4 },
  fieldRow: { alignItems: "center", flexDirection: "row", minHeight: 36, paddingVertical: 3 },
  field: { width: 190 },
  sheetField: { borderWidth: 0, maxWidth: 200, minWidth: 150 },
  fieldLabel: { flex: 1, fontSize: 13 },
  check: { alignItems: "center", flexDirection: "row", gap: 10, height: 30 },
  box: { alignItems: "center", borderRadius: 4.5, borderWidth: 1.5, height: 16, justifyContent: "center", width: 16 },
  checkLabel: { flex: 1, fontSize: 13 },
  checkCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  popFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  footerClear: { fontSize: 13, fontWeight: "600" },
  saveView: { alignItems: "center", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 6, height: 30, paddingHorizontal: 12 },
  saveLabel: { fontSize: 13, fontWeight: "600" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, bottom: 0, left: 0, maxHeight: "92%", paddingBottom: 28, position: "absolute", right: 0 },
  grabber: { alignSelf: "center", borderRadius: 3, height: 5, marginTop: 8, width: 36 },
  sheetHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetAction: { fontSize: 17 },
  sheetDone: { fontWeight: "600" },
  sheetBody: { gap: 8, paddingBottom: 16, paddingHorizontal: 16 },
  sheetCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "visible" },
  sheetGroup: { fontSize: 13, paddingBottom: 6, paddingHorizontal: 14, paddingTop: 14 },
  sheetRow: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", minHeight: 44, paddingHorizontal: 14, position: "relative" },
  sheetIcon: { marginRight: 12 },
  sheetLabel: { flex: 1, fontSize: 17 },
  showButton: { alignItems: "center", borderRadius: 12, height: 50, justifyContent: "center", marginHorizontal: 16, marginTop: 4 },
  showLabel: { fontSize: 17, fontWeight: "600" },
});
