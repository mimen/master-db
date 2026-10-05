import { Ionicons } from "@expo/vector-icons";
import type { StateCounts, StateFilter, TypeFilter } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { useSignal, LAZY, SNAPPY, type SignalColors } from "./conversations/signal";
import {
  INCLUDE_LABELS,
  LENSES,
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
 * Unread a gray one. The underline stretches toward the new tab: the leading edge on snappy,
 * the trailing edge on lazy.
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
  const signal = useSignal();
  const reduceMotion = useReducedMotion();
  const layouts = useRef(new Map<Lens, { x: number; width: number }>()).current;
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    const target = layouts.get(state as Lens);
    if (!target) return;
    const toLeft = target.x;
    const toRight = target.x + target.width;
    if (reduceMotion || right.value === 0) {
      left.value = toLeft;
      right.value = toRight;
      return;
    }
    const movingRight = toLeft > left.value;
    left.value = withSpring(toLeft, movingRight ? LAZY : SNAPPY);
    right.value = withSpring(toRight, movingRight ? SNAPPY : LAZY);
  }, [state, measured, layouts, left, right, reduceMotion]);

  const bar = useAnimatedStyle(() => ({ left: left.value, width: Math.max(0, right.value - left.value) }));
  const active = LENSES.some((lens) => lens.value === state);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={phone}
      contentContainerStyle={[styles.tabs, phone && styles.tabsPhone]}
      accessibilityRole="tablist"
      accessibilityLabel="Lenses"
    >
      {LENSES.map((lens, index) => {
        const selected = lens.value === state;
        const count = lens.count ? counts?.[lens.value] : undefined;
        const turnCount = lens.count === "turn" && (count ?? 0) > 0;
        return (
          <Pressable
            key={lens.value}
            accessibilityRole="tab"
            aria-selected={selected}
            accessibilityLabel={count === undefined ? lens.label : `${lens.label}, ${count}`}
            accessibilityHint={WEB ? `Command ${index + 1}` : undefined}
            onPress={() => onSelect(lens.value)}
            onLayout={(e) => {
              layouts.set(lens.value, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
              setMeasured((n) => n + 1);
            }}
            style={[styles.tab, phone && styles.tabPhone, NO_SELECT]}
          >
            <Text numberOfLines={1} style={[phone ? styles.tabLabelPhone : styles.tabLabel, { color: selected ? signal.text : signal.textTertiary }]}>
              {lens.label}
            </Text>
            {count !== undefined ? (
              <Text style={[phone ? styles.tabCountPhone : styles.tabCount, { color: turnCount ? signal.turn : signal.textTertiary }, turnCount && styles.tabCountTurn]}>
                {formatCount(count)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {active && !phone ? <Reanimated.View pointerEvents="none" style={[styles.underline, { backgroundColor: signal.lensBar }, bar]} /> : null}
    </ScrollView>
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
  const signal = useSignal();
  if (chips.length === 0 && views.length === 0) return null;
  const clearAll = chips.length > 0 ? (
    <Pressable accessibilityRole="button" onPress={onClearAll} hitSlop={6} style={NO_SELECT}>
      <Text style={[styles.clearAll, { color: signal.textSecondary }]}>Clear all</Text>
    </Pressable>
  ) : null;
  const chipViews = (
    <>
      {views.map((view) => (
        <View key={view.id} style={[styles.chip, styles.viewChip, { backgroundColor: signal.chipBg, borderColor: signal.chipBorder }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open view ${view.name}`} onPress={() => onOpenView(view)} style={[styles.chipBody, NO_SELECT]}>
            <Ionicons aria-hidden name="bookmark-outline" size={11} color={signal.icon} />
            <Text numberOfLines={1} style={[styles.chipLabel, { color: signal.text }]}>{view.name}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete view ${view.name}`} onPress={() => onDeleteView(view)} hitSlop={6} style={[styles.chipX, NO_SELECT]}>
            <Ionicons aria-hidden name="close" size={11} color={signal.icon} />
          </Pressable>
        </View>
      ))}
      {chips.map((chip) => (
        <View key={chip.key} style={[styles.chip, phone && styles.chipPhone, { backgroundColor: signal.chipBg, borderColor: signal.chipBorder }]}>
          <Text numberOfLines={1} style={[styles.chipLabel, phone && styles.chipLabelPhone, { color: signal.text }]}>
            {chip.prefix ? <Text style={{ color: signal.textSecondary, fontWeight: "400" }}>{chip.prefix} </Text> : null}
            {chip.label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove filter ${chip.prefix ? `${chip.prefix} ` : ""}${chip.label}`}
            onPress={() => onRemove(chip)}
            hitSlop={6}
            style={[styles.chipX, NO_SELECT]}
          >
            <Ionicons aria-hidden name="close" size={phone ? 14 : 11} color={signal.icon} />
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
            <Text style={[styles.countLineText, { color: signal.textSecondary }]}>{countLine}</Text>
            {clearAll}
          </View>
        ) : null}
      </View>
    );
  }
  return <View style={styles.chips}>{chipViews}{clearAll}</View>;
}

interface Option<V extends string> {
  value: V;
  label: string;
  dot?: string;
}

/**
 * A value-showing dropdown with a check on the current choice.
 * TODO(signal-dropdown): replace with components/ui/dropdown.tsx once the settings unit lands it.
 */
function Dropdown<V extends string>({
  label,
  icon,
  options,
  selected,
  display,
  onSelect,
  multi = false,
  open,
  onOpenChange,
  phone,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  options: Option<V>[];
  selected: readonly V[];
  display: string;
  onSelect: (value: V) => void;
  multi?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: boolean;
}) {
  const signal = useSignal();
  const trigger = phone ? (
    <View style={styles.sheetRowValue}>
      <Text numberOfLines={1} style={[styles.sheetValue, { color: signal.textSecondary }]}>{display}</Text>
      <Ionicons aria-hidden name="chevron-expand-outline" size={14} color={signal.textSecondary} />
    </View>
  ) : (
    <View style={[styles.dd, { backgroundColor: signal.surface, borderColor: open ? signal.focusRing : signal.dividerStrong }, open && styles.ddOpen]}>
      <Text numberOfLines={1} style={[styles.ddValue, { color: signal.text }]}>{display}</Text>
      <Ionicons aria-hidden name="chevron-expand-outline" size={13} color={signal.icon} />
    </View>
  );
  return (
    <View style={[phone ? styles.sheetRow : styles.fieldRow, { zIndex: open ? 20 : 0 }, phone && { borderBottomColor: signal.divider }]}>
      <Pressable
        accessibilityRole="button"
        aria-haspopup="menu"
        aria-expanded={open}
        accessibilityLabel={`${label}, ${display}`}
        onPress={() => onOpenChange(!open)}
        style={[styles.fieldPress, NO_SELECT]}
      >
        {phone ? <Ionicons aria-hidden name={icon} size={20} color={signal.icon} style={styles.sheetIcon} /> : null}
        <Text style={[phone ? styles.sheetLabel : styles.fieldLabel, { color: phone ? signal.text : signal.textSecondary }]}>{label}</Text>
        {trigger}
      </Pressable>
      {open ? (
        <View accessibilityRole="menu" aria-label={label} style={[styles.menu, phone && styles.menuPhone, { backgroundColor: signal.popBg }, WEB && ({ boxShadow: signal.popShadow } as object)]}>
          {options.length === 0 ? <Text style={[styles.menuEmpty, { color: signal.textTertiary }]}>No tags yet</Text> : null}
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole={multi ? "checkbox" : "radio"}
                aria-checked={checked}
                onPress={() => {
                  onSelect(option.value);
                  if (!multi) onOpenChange(false);
                }}
                style={({ hovered, pressed }) => [styles.menuItem, phone && styles.menuItemPhone, (checked || hovered || pressed) && { backgroundColor: signal.popSelected }, NO_SELECT]}
              >
                <View style={styles.menuCheck}>{checked ? <Ionicons aria-hidden name="checkmark" size={phone ? 17 : 14} color={signal.text} /> : null}</View>
                {option.dot ? <View style={[styles.dot, { backgroundColor: option.dot }]} /> : null}
                <Text numberOfLines={1} style={[styles.menuLabel, phone && styles.menuLabelPhone, { color: signal.text }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
  signal,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  checked: boolean;
  onToggle: () => void;
  phone: boolean;
  signal: SignalColors;
}) {
  if (phone) {
    return (
      <View style={[styles.sheetRow, { borderBottomColor: signal.divider }]}>
        <Ionicons aria-hidden name={icon} size={20} color={signal.icon} style={styles.sheetIcon} />
        <Text style={[styles.sheetLabel, { color: signal.text }]}>{label}</Text>
        <Switch
          accessibilityLabel={`${label}, ${count}`}
          value={checked}
          onValueChange={onToggle}
          trackColor={{ false: signal.switchOff, true: signal.switchOn }}
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
      <View style={[styles.box, checked ? { backgroundColor: signal.switchOn, borderColor: signal.switchOn } : { borderColor: signal.switchOff }]}>
        {checked ? <Ionicons aria-hidden name="checkmark" size={12} color={signal.onSwitch} /> : null}
      </View>
      <Ionicons aria-hidden name={icon} size={15} color={signal.icon} />
      <Text style={[styles.checkLabel, { color: signal.text }]}>{label}</Text>
      <Text style={[styles.checkCount, { color: signal.textTertiary }]}>{count}</Text>
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
  const signal = useSignal();
  const reduceMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const [menu, setMenu] = useState<string | null>(null);
  const phone = anchor === null;
  const scale = useSharedValue(0.98);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!visible) {
      setMenu(null);
      scale.value = 0.98;
      opacity.value = 0;
      return;
    }
    scale.value = reduceMotion ? 1 : withSpring(1, SNAPPY);
    opacity.value = reduceMotion ? 1 : withSpring(1, SNAPPY);
  }, [visible, reduceMotion, scale, opacity]);
  const grow = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  const set = (patch: Partial<Refinements>) => onRefinementsChange({ ...r, ...patch });
  const menuProps = (key: string) => ({ open: menu === key, onOpenChange: (open: boolean) => setMenu(open ? key : null), phone });
  const tagDisplay = r.tags.length === 0 ? "Any tag" : r.tags.length === 1 ? r.tags[0]! : `${r.tags.length} tags`;
  const controls = (
    <View style={[phone ? [styles.sheetCard, { backgroundColor: signal.surface, borderColor: signal.divider }] : [styles.band, { borderBottomColor: signal.divider }], styles.raised]}>
      <Dropdown label="People" icon="people-outline" display={PEOPLE_LABELS[type]} selected={[type]}
        options={PEOPLE_ORDER.map((value) => ({ value, label: PEOPLE_LABELS[value] }))}
        onSelect={props.onTypeChange} {...menuProps("people")} />
      <Dropdown label="Service" icon="chatbubble-outline" display={SERVICE_LABELS[r.service]} selected={[r.service]}
        options={SERVICES.map((value) => ({ value, label: SERVICE_LABELS[value], dot: value === "iMessage" ? signal.imessage : value === "SMS" ? signal.sms : undefined }))}
        onSelect={(service) => set({ service })} {...menuProps("service")} />
      <Dropdown label="Time" icon="time-outline" display={TIME_LABELS[r.time]} selected={[r.time]}
        options={TIMES.map((value) => ({ value, label: TIME_LABELS[value] }))}
        onSelect={(time) => set({ time })} {...menuProps("time")} />
      <Dropdown label="Priority" icon="star-outline" display={PRIORITY_LABELS[r.priority]} selected={[r.priority]}
        options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
        onSelect={(priority) => set({ priority })} {...menuProps("priority")} />
      <Dropdown label="Tags" icon="pricetag-outline" display={tagDisplay} selected={r.tags} multi
        options={props.tags.map((value) => ({ value, label: value }))}
        onSelect={(tag) => set({ tags: toggled(r.tags, tag) })} {...menuProps("tags")} />
    </View>
  );
  const toggles = (title: string, keys: readonly (OnlyKey | IncludeKey)[]) => (
    <View style={phone ? null : [styles.band, { borderBottomColor: signal.divider }]}>
      <Text style={[phone ? styles.sheetGroup : styles.bandTitle, { color: signal.textSecondary }]}>{title}</Text>
      <View style={phone ? [styles.sheetCard, { backgroundColor: signal.surface, borderColor: signal.divider }] : null}>
        {keys.map((key) => {
          const only = (ONLY_KEYS as readonly string[]).includes(key);
          const checked = only ? r.only.includes(key as OnlyKey) : r.include.includes(key as IncludeKey);
          return (
            <Toggle
              key={key}
              signal={signal}
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
          style={[styles.popover, { top: anchor.y + anchor.height + 6, left, width, backgroundColor: signal.popBg }, WEB && ({ boxShadow: signal.popShadow, transformOrigin: "top left" } as object), grow]}
        >
          <Pressable accessible={false} onPress={() => setMenu(null)} style={[styles.popHeader, { borderBottomColor: signal.divider }]}>
            <Text style={[styles.popTitle, { color: signal.text }]}>Filter</Text>
            <Text style={[styles.popCount, { color: signal.textSecondary }]}>Showing {props.showing} of {props.total} in {props.lensLabel}</Text>
          </Pressable>
          {controls}
          {toggles("Only show", ONLY_KEYS)}
          {toggles("Also include", INCLUDE_KEYS)}
          <View style={styles.popFooter}>
            <Pressable accessibilityRole="button" onPress={props.onClearAll} hitSlop={6} style={NO_SELECT}>
              <Text style={[styles.footerClear, { color: signal.textSecondary }]}>Clear all</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={props.onSaveView}
              style={({ hovered }) => [styles.saveView, { borderColor: signal.dividerStrong }, hovered && { backgroundColor: signal.rowHover }, NO_SELECT]}
            >
              <Ionicons aria-hidden name="bookmark-outline" size={14} color={signal.text} />
              <Text style={[styles.saveLabel, { color: signal.text }]}>Save as view</Text>
            </Pressable>
          </View>
        </Reanimated.View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close filters" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: signal.scrim }]} />
      <View role="dialog" aria-label="Filter conversations" style={[styles.sheet, { backgroundColor: signal.popBg }]}>
        <View style={[styles.grabber, { backgroundColor: signal.dividerStrong }]} />
        <View style={styles.sheetHeader}>
          <Pressable accessibilityRole="button" onPress={props.onClearAll} hitSlop={8} style={NO_SELECT}>
            <Text style={[styles.sheetAction, { color: signal.textSecondary }]}>Clear</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { color: signal.text }]}>Filter</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={NO_SELECT}>
            <Text style={[styles.sheetAction, styles.sheetDone, { color: signal.text }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          {controls}
          {toggles("Only show", ONLY_KEYS)}
          {toggles("Also include", INCLUDE_KEYS)}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={[styles.showButton, { backgroundColor: signal.switchOn }]}>
          <Text style={[styles.showLabel, { color: signal.onSwitch }]}>
            Show {props.showing} {props.showing === 1 ? "conversation" : "conversations"}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 12, position: "relative" },
  tabsPhone: { gap: 18, paddingHorizontal: 20 },
  tab: { alignItems: "flex-start", flexDirection: "row", paddingBottom: 10 },
  tabPhone: { paddingBottom: 6 },
  // TODO(signal-tokens): header family arrives with U1's type tokens.
  tabLabel: { fontSize: 14.5, fontWeight: "600", letterSpacing: -0.15, lineHeight: 18 },
  tabLabelPhone: { fontSize: 25, fontWeight: "700", letterSpacing: -0.4, lineHeight: 30 },
  tabCount: { fontSize: 11.5, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 18, marginLeft: 4 },
  tabCountPhone: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "500", marginLeft: 3, marginTop: 2 },
  tabCountTurn: { fontWeight: "600" },
  underline: { borderRadius: 2, bottom: 0, height: 2, position: "absolute" },
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
  fieldRow: { paddingVertical: 3, position: "relative" },
  fieldPress: { alignItems: "center", flex: 1, flexDirection: "row", minHeight: 30 },
  fieldLabel: { flex: 1, fontSize: 13 },
  dd: { alignItems: "center", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 8, height: 30, justifyContent: "space-between", paddingLeft: 11, paddingRight: 7, width: 190 },
  ddOpen: { borderWidth: 1.5 },
  ddValue: { flex: 1, fontSize: 13 },
  menu: { borderRadius: 12, minWidth: 190, padding: 5, position: "absolute", right: 0, top: 36 },
  menuPhone: { minWidth: 230, right: 8, top: 46 },
  menuItem: { alignItems: "center", borderRadius: 7, flexDirection: "row", gap: 6, height: 30, paddingHorizontal: 6 },
  menuItemPhone: { height: 42 },
  menuCheck: { alignItems: "center", width: 18 },
  dot: { borderRadius: 4, height: 7, width: 7 },
  menuLabel: { fontSize: 13 },
  menuLabelPhone: { fontSize: 17 },
  menuEmpty: { fontSize: 12, padding: 8 },
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
  sheetRowValue: { alignItems: "center", flexDirection: "row", gap: 4, marginLeft: "auto" },
  sheetValue: { fontSize: 17 },
  showButton: { alignItems: "center", borderRadius: 12, height: 50, justifyContent: "center", marginHorizontal: 16, marginTop: 4 },
  showLabel: { fontSize: 17, fontWeight: "600" },
});
