import { useState } from "react";
import type { StateCounts, StateFilter, TypeFilter } from "@shared/types";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { CardShadow, Radii, Type } from "@/constants/theme";
import { OverlayShell } from "./overlay-shell";
import { filterChipFill } from "./sidebar/chrome-control-fill";
import {
  activeInboxFilterCount,
  resetInboxFilters,
  selectInboxFilter,
  type InboxFilterSelection,
  type InboxFilters,
} from "@/lib/inbox-model";

interface FilterOption<Value extends StateFilter | TypeFilter> {
  value: Value;
  label: string;
}

export const STATE_FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "unresponded", label: "Unresponded" },
  { value: "waiting", label: "Waiting" },
  { value: "archived", label: "Archived" },
] as const satisfies readonly FilterOption<StateFilter>[];

/** The desktop triage control keeps the day-to-day queue states close at hand. */
const COMPACT_STATE_FILTERS = [
  { value: "unresponded", label: "Needs reply" },
  { value: "waiting", label: "Waiting" },
  { value: "all", label: "All" },
] as const satisfies readonly FilterOption<StateFilter>[];

export const TYPE_FILTERS = [
  { value: "all", label: "Everyone" },
  { value: "dm", label: "DMs" },
  { value: "group", label: "Groups" },
  { value: "unknown", label: "Unknown" },
] as const satisfies readonly FilterOption<TypeFilter>[];

export interface ConversationFiltersProps {
  filters: InboxFilters;
  counts: StateCounts | null;
  onFiltersChange: (filters: InboxFilters) => void;
  /** Desktop: tighter pills so the rail reads as chrome, not content. */
  compact?: boolean;
}

function formatCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

function filterAccessibilityLabel(label: string, count: number | undefined): string {
  if (count === undefined) return label;
  return `${label}, ${formatCount(count)} conversations`;
}

function FilterPill({
  label,
  count,
  selected,
  selection,
  onSelect,
  compact = false,
}: {
  label: string;
  count?: number;
  selected: boolean;
  selection: InboxFilterSelection;
  onSelect: (selection: InboxFilterSelection) => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const visual = useTriageTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={filterAccessibilityLabel(label, count)}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(selection)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.pill,
        compact && styles.pillCompact,
        filterChipFill(theme, { selected, hovered, pressed }),
        compact ? ({
          backgroundColor: selected ? visual.activeChip : pressed || hovered ? visual.controlFill : visual.inactiveChip,
          boxShadow: selected ? "none" : "0 1px 2px rgba(0,0,0,0.10)",
        } as object) : null,
        Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          compact && styles.pillLabelCompact,
          { color: compact ? selected ? (visual.activeChip === "#f4f4f6" ? "#1a1a1c" : "#ffffff") : visual.meta : selected ? theme.background : theme.textSecondary },
        ]}
      >
        {label}
      </Text>
      {count !== undefined && (
        <Text
          style={[
            styles.pillCount,
            compact && styles.pillCountCompact,
            { color: selected ? theme.background : theme.textSecondary },
          ]}
        >
          {formatCount(count)}
        </Text>
      )}
    </Pressable>
  );
}

/** A compact, touch-friendly filter rail that stays one horizontal row at every width. */
export function ConversationFilters({
  filters,
  counts,
  onFiltersChange,
  compact = false,
}: ConversationFiltersProps) {
  const theme = useTheme();
  const select = (selection: InboxFilterSelection): void => {
    onFiltersChange(selectInboxFilter(filters, selection));
  };

  return (
    <View style={compact ? styles.railCompact : styles.rail}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.railContent, compact && styles.railContentCompact]}
        accessibilityLabel="Conversation filters"
      >
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Conversation state"
          style={[styles.filterGroup, compact && styles.filterGroupCompact]}
        >
          {(compact ? COMPACT_STATE_FILTERS : STATE_FILTERS).map((filter) => (
            <FilterPill key={filter.value} compact={compact} label={filter.label} count={counts?.[filter.value]} selected={filters.state === filter.value} selection={{ kind: "state", value: filter.value }} onSelect={select} />
          ))}
        </View>
        <View accessible={false} style={[styles.divider, { backgroundColor: theme.divider }]} />
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Conversation type"
          style={[styles.filterGroup, compact && styles.filterGroupCompact]}
        >
          {TYPE_FILTERS.filter((filter) => !compact || filter.value !== "unknown").map((filter) => (
            <FilterPill
              key={filter.value}
              compact={compact}
              label={filter.label}
              selected={filters.type === filter.value}
              selection={{ kind: "type", value: filter.value }}
              onSelect={select}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function FilterMenuOption({
  label,
  count,
  selected,
  selection,
  onSelect,
  compact = false,
}: {
  label: string;
  count?: number;
  selected: boolean;
  selection: InboxFilterSelection;
  onSelect: (selection: InboxFilterSelection) => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={filterAccessibilityLabel(label, count)}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(selection)}
      style={({ pressed }) => [
        styles.menuOption,
        compact && styles.popoverOption,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Text
        accessibilityElementsHidden
        style={[styles.check, compact && styles.popoverCheck, { color: theme.accent }]}
      >
        {selected ? "✓" : ""}
      </Text>
      <Text
        style={[styles.menuOptionLabel, compact && styles.popoverOptionLabel, { color: theme.text }]}
      >
        {label}
      </Text>
      {count !== undefined && (
        <Text
          style={[
            styles.menuOptionCount,
            compact && styles.popoverOptionCount,
            { color: theme.textSecondary },
          ]}
        >
          {formatCount(count)}
        </Text>
      )}
    </Pressable>
  );
}

export interface FilterAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConversationFiltersModalProps extends ConversationFiltersProps {
  visible: boolean;
  onClose: () => void;
  /** Desktop: render as a popover anchored to the filter button instead of a sheet. */
  anchor?: FilterAnchor | null;
}

/**
 * Adapter for the same two-lens model. On mobile it's a bottom sheet; on desktop
 * (when an anchor is supplied) it's a popover mounted at the filter button.
 * Selections stay open so a person can combine state and type before dismissing.
 */
export function ConversationFiltersModal({
  visible,
  onClose,
  filters,
  counts,
  onFiltersChange,
  anchor = null,
}: ConversationFiltersModalProps) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const select = (selection: InboxFilterSelection): void => {
    onFiltersChange(selectInboxFilter(filters, selection));
  };

  if (anchor) {
    const popoverWidth = Math.min(376, windowWidth - 16);
    const left = Math.min(
      Math.max(8, anchor.x + anchor.width - popoverWidth),
      windowWidth - popoverWidth - 8,
    );
    const top = anchor.y + anchor.height + 6;
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close conversation filters"
          onPress={onClose}
          style={styles.popoverBackdrop}
        />
        <View
          accessibilityLabel="Conversation filters"
          style={[
            styles.popover,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.divider,
              top,
              left,
              width: popoverWidth,
            },
          ]}
        >
          <View style={styles.popoverBody}>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Conversation state"
              style={styles.popoverStateColumn}
            >
              <Text style={[styles.popoverGroupTitle, { color: theme.textSecondary }]}>State</Text>
              {STATE_FILTERS.map((filter) => (
                <FilterMenuOption
                  key={filter.value}
                  compact
                  label={filter.label}
                  count={counts?.[filter.value]}
                  selected={filters.state === filter.value}
                  selection={{ kind: "state", value: filter.value }}
                  onSelect={select}
                />
              ))}
            </View>
            <View style={[styles.popoverColumnDivider, { backgroundColor: theme.divider }]} />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Conversation type"
              style={styles.popoverTypeColumn}
            >
              <Text style={[styles.popoverGroupTitle, { color: theme.textSecondary }]}>Type</Text>
              {TYPE_FILTERS.map((filter) => (
                <FilterMenuOption
                  key={filter.value}
                  compact
                  label={filter.label}
                  selected={filters.type === filter.value}
                  selection={{ kind: "type", value: filter.value }}
                  onSelect={select}
                />
              ))}
            </View>
          </View>
          <View style={[styles.popoverFooter, { borderTopColor: theme.divider }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset conversation filters"
              onPress={() => onFiltersChange(resetInboxFilters())}
            >
              <Text style={[styles.popoverResetLabel, { color: theme.accent }]}>Reset</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <OverlayShell
      visible={visible}
      onClose={onClose}
      animationType="slide"
      // Lighter scrim than the shared 0.45 backdrop token — intentional, not swept.
      backdropColor="rgba(0,0,0,0.35)"
      backdropStyle={styles.modalRoot}
      backdropAccessibilityRole="button"
      backdropAccessibilityLabel="Close conversation filters"
      card={false}
      cardStyle={styles.sheetWrapper}
    >
      <View
        accessibilityViewIsModal
        accessibilityLabel="Conversation filters"
        style={[styles.menu, { backgroundColor: theme.backgroundElement }]}
      >
        <View style={styles.menuHeader}>
          <Text style={[styles.menuTitle, { color: theme.text }]}>Filters</Text>
          <Text style={[styles.menuSummary, { color: theme.textSecondary }]}>
            {activeInboxFilterCount(filters)} active
          </Text>
        </View>
        <ScrollView
          style={styles.menuContent}
          contentContainerStyle={styles.menuContentContainer}
          showsVerticalScrollIndicator={false}
        >
          <View accessibilityRole="radiogroup" accessibilityLabel="Conversation state">
            <Text style={[styles.groupTitle, { color: theme.textSecondary }]}>State</Text>
            {STATE_FILTERS.map((filter) => (
              <FilterMenuOption
                key={filter.value}
                label={filter.label}
                count={counts?.[filter.value]}
                selected={filters.state === filter.value}
                selection={{ kind: "state", value: filter.value }}
                onSelect={select}
              />
            ))}
          </View>
          <View style={[styles.menuDivider, { backgroundColor: theme.divider }]} />
          <View accessibilityRole="radiogroup" accessibilityLabel="Conversation type">
            <Text style={[styles.groupTitle, { color: theme.textSecondary }]}>Type</Text>
            {TYPE_FILTERS.map((filter) => (
              <FilterMenuOption
                key={filter.value}
                label={filter.label}
                selected={filters.type === filter.value}
                selection={{ kind: "type", value: filter.value }}
                onSelect={select}
              />
            ))}
          </View>
        </ScrollView>
        <View style={styles.menuActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset conversation filters"
            onPress={() => onFiltersChange(resetInboxFilters())}
            style={({ pressed }) => [styles.resetButton, pressed && { opacity: 0.65 }]}
          >
            <Text style={[styles.resetButtonLabel, { color: theme.accent }]}>Reset</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done filtering conversations"
            onPress={onClose}
            style={({ pressed }) => [
              styles.doneButton,
              { backgroundColor: theme.accent },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.doneButtonLabel, { color: theme.background }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </OverlayShell>
  );
}

const styles = StyleSheet.create({
  rail: {
    height: 50,
  },
  railCompact: {
    height: 36,
  },
  railContent: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
  },
  railContentCompact: {
    gap: 9,
  },
  filterGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  filterGroupCompact: {
    gap: 5,
  },
  divider: {
    height: 22,
    width: StyleSheet.hairlineWidth,
  },
  pill: {
    alignItems: "center",
    borderRadius: 17,
    flexDirection: "row",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
  },
  pillCompact: {
    borderRadius: 12,
    gap: 4,
    height: 24,
    paddingHorizontal: 11,
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  pillLabelCompact: {
    fontSize: 11,
  },
  pillCount: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  pillCountCompact: {
    fontSize: 11,
  },
  popoverBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  popover: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    position: "absolute",
    ...CardShadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
  },
  popoverBody: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  popoverStateColumn: {
    flex: 1.3,
  },
  popoverTypeColumn: {
    flex: 1,
  },
  popoverColumnDivider: {
    alignSelf: "stretch",
    marginHorizontal: 6,
    marginVertical: 2,
    width: StyleSheet.hairlineWidth,
  },
  popoverGroupTitle: {
    fontSize: Type.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingBottom: 4,
    paddingHorizontal: 12,
    textTransform: "uppercase",
  },
  popoverFooter: {
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  popoverResetLabel: {
    fontSize: Type.secondary,
    fontWeight: "600",
  },
  // Color + press-dismiss live on OverlayShell's own backdrop; this anchors
  // `menu` to the bottom. alignItems MUST be reset too: the shell centers its
  // child by default (correct for a dialog), which made this sheet shrink to
  // its content width and float as a narrow column instead of spanning the
  // screen like a bottom sheet.
  modalRoot: {
    alignItems: "stretch",
    justifyContent: "flex-end",
  },
  // OverlayShell's press-swallowing wrapper. It gets the sheet's SIZE because
  // it's the direct child of the (flex:1) backdrop, so a percentage has a
  // definite parent to resolve against. Putting maxHeight on `menu` instead
  // asked Yoga to size a child by a percentage of a parent whose own height
  // was being derived from that child — the circularity left the sheet
  // stretched to the cap with dead space above the buttons.
  sheetWrapper: {
    maxHeight: "88%",
    width: "100%",
  },
  menu: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    flexShrink: 1,
    paddingBottom: 20,
    paddingTop: 18,
  },
  menuContent: {
    flexShrink: 1,
  },
  menuContentContainer: {
    paddingBottom: 4,
  },
  menuHeader: {
    alignItems: "baseline",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  menuTitle: {
    fontSize: 21,
    fontWeight: "700",
  },
  menuSummary: {
    fontSize: 14,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: "600",
    paddingBottom: 4,
    paddingHorizontal: 20,
    textTransform: "uppercase",
  },
  menuOption: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: 20,
  },
  popoverOption: {
    minHeight: 34,
    paddingHorizontal: 12,
  },
  check: {
    fontSize: 16,
    fontWeight: "700",
    width: 24,
  },
  popoverCheck: {
    fontSize: 14,
    width: 18,
  },
  menuOptionLabel: {
    flex: 1,
    fontSize: 16,
  },
  popoverOptionLabel: {
    fontSize: 14,
  },
  menuOptionCount: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  popoverOptionCount: {
    fontSize: 12,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginVertical: 10,
  },
  menuActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  resetButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  resetButtonLabel: {
    fontSize: Type.body,
    fontWeight: "600",
  },
  doneButton: {
    alignItems: "center",
    borderRadius: Radii.chip,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 16,
  },
  doneButtonLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
});
