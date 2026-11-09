import Ionicons from "@expo/vector-icons/Ionicons";
import type { Platform as ChatPlatform, TypeFilter } from "@shared/types";
import { useEffect } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { SourceIcon } from "./service-label";
import { Dropdown, type DropdownOption } from "./ui/dropdown";
import { Springs } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";
import { Toggle as Switch } from "@/components/ui/toggle";
import {
  INCLUDE_LABELS,
  ONLY_LABELS,
  PEOPLE_LABELS,
  PEOPLE_ORDER,
  PRIORITY_LABELS,
  serviceOptions,
  TIME_LABELS,
  toggled,
  type IncludeKey,
  type OnlyKey,
  type PriorityLevel,
  type Refinements,
  type TimeRange,
} from "@/lib/inbox-model";

/** The filter popover and sheet. Its own module, so it loads on demand rather than with the first list. */

type ThemeColors = ReturnType<typeof useTheme>;

const WEB = Platform.OS === "web";
const NO_SELECT = WEB ? ({ userSelect: "none", cursor: "pointer" } as object) : null;

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
        <Switch accessibilityLabel={`${label}, ${count}`} value={checked} onValueChange={onToggle} />
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
  platforms: readonly ChatPlatform[];
  counts: Record<OnlyKey | IncludeKey, number>;
  showing: number;
  total: number;
  lensLabel: string;
  /** Today keeps the build's order and has its own Settled section, so Sort and Also include are left out. */
  today?: boolean;
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
        options={serviceOptions(props.platforms).map(({ value, label, badge }) => ({ value, label, icon: badge ? <SourceIcon badge={badge} decorative /> : undefined }))}
        onChange={(service) => set({ service })} />
      <Field label="Time" icon="time-outline" phone={phone} value={r.time}
        options={TIMES.map((value) => ({ value, label: TIME_LABELS[value] }))}
        onChange={(time) => set({ time })} />
      <Field label="Priority" icon="star-outline" phone={phone} value={r.priority}
        options={PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
        onChange={(priority) => set({ priority })} />
      {props.today ? null : (
        <Field label="Sort" icon="swap-vertical-outline" phone={phone} value={r.oldestFirst ? "oldest" : "newest"}
          options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]}
          onChange={(order) => set({ oldestFirst: order === "oldest" })} />
      )}
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
          {props.today ? null : toggles("Also include", INCLUDE_KEYS)}
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
          {props.today ? null : toggles("Also include", INCLUDE_KEYS)}
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
