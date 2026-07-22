import type { StateCounts, StateFilter, TypeFilter } from "@shared/types";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
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
}: {
  label: string;
  count?: number;
  selected: boolean;
  selection: InboxFilterSelection;
  onSelect: (selection: InboxFilterSelection) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={filterAccessibilityLabel(label, count)}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(selection)}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: selected ? theme.text : theme.backgroundElement },
        pressed && !selected && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Text style={[styles.pillLabel, { color: selected ? theme.background : theme.textSecondary }]}>
        {label}
      </Text>
      {count !== undefined && (
        <Text style={[styles.pillCount, { color: selected ? theme.background : theme.textSecondary }]}>
          {formatCount(count)}
        </Text>
      )}
    </Pressable>
  );
}

/** A compact, touch-friendly filter rail that stays one horizontal row at every width. */
export function ConversationFilters({ filters, counts, onFiltersChange }: ConversationFiltersProps) {
  const theme = useTheme();
  const select = (selection: InboxFilterSelection): void => {
    onFiltersChange(selectInboxFilter(filters, selection));
  };

  return (
    <View style={styles.rail}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
        accessibilityLabel="Conversation filters"
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="Conversation state" style={styles.filterGroup}>
          {STATE_FILTERS.map((filter) => (
            <FilterPill
              key={filter.value}
              label={filter.label}
              count={counts?.[filter.value]}
              selected={filters.state === filter.value}
              selection={{ kind: "state", value: filter.value }}
              onSelect={select}
            />
          ))}
        </View>
        <View accessible={false} style={[styles.divider, { backgroundColor: theme.divider }]} />
        <View accessibilityRole="radiogroup" accessibilityLabel="Conversation type" style={styles.filterGroup}>
          {TYPE_FILTERS.map((filter) => (
            <FilterPill
              key={filter.value}
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
}: {
  label: string;
  count?: number;
  selected: boolean;
  selection: InboxFilterSelection;
  onSelect: (selection: InboxFilterSelection) => void;
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
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Text accessibilityElementsHidden style={[styles.check, { color: theme.accent }]}>
        {selected ? "✓" : ""}
      </Text>
      <Text style={[styles.menuOptionLabel, { color: theme.text }]}>{label}</Text>
      {count !== undefined && (
        <Text style={[styles.menuOptionCount, { color: theme.textSecondary }]}>{formatCount(count)}</Text>
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
  const select = (selection: InboxFilterSelection): void => {
    onFiltersChange(selectInboxFilter(filters, selection));
  };

  if (anchor) {
    const POPOVER_WIDTH = 260;
    // Anchor the popover's top-left corner at the button.
    const left = Math.max(8, anchor.x);
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
            { backgroundColor: theme.backgroundElement, borderColor: theme.divider, top, left, width: POPOVER_WIDTH },
          ]}
        >
          <ScrollView
            style={styles.popoverContent}
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
          <View style={[styles.popoverFooter, { borderTopColor: theme.divider }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset conversation filters"
              onPress={() => onFiltersChange(resetInboxFilters())}
            >
              <Text style={[styles.resetButtonLabel, { color: theme.accent }]}>Reset</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close conversation filters"
          onPress={onClose}
          style={styles.backdrop}
        />
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rail: {
    height: 50,
  },
  railContent: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
  },
  filterGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
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
  pillLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  pillCount: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  popoverBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  popover: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 460,
    overflow: "hidden",
    paddingTop: 10,
    position: "absolute",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
  },
  popoverContent: {
    flexShrink: 1,
  },
  popoverFooter: {
    alignItems: "flex-start",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  modalRoot: {
    backgroundColor: "rgba(0,0,0,0.35)",
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menu: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
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
  check: {
    fontSize: 16,
    fontWeight: "700",
    width: 24,
  },
  menuOptionLabel: {
    flex: 1,
    fontSize: 16,
  },
  menuOptionCount: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
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
    fontSize: 16,
    fontWeight: "600",
  },
  doneButton: {
    alignItems: "center",
    borderRadius: 10,
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
