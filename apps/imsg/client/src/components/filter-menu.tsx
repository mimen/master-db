import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import type { StateCounts, StateFilter, TypeFilter } from "@/lib/types";

const STATES: Array<{ value: StateFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "unresponded", label: "Unresponded" },
  { value: "waiting", label: "Waiting" },
  { value: "archived", label: "Archived" },
];

const TYPES: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "dm", label: "DMs" },
  { value: "group", label: "Groups" },
  { value: "unknown", label: "Unknown" },
];

interface FilterMenuProps {
  visible: boolean;
  onClose: () => void;
  state: StateFilter;
  type: TypeFilter;
  counts: StateCounts | null;
  onStateChange: (state: StateFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
}

export function FilterMenu({
  visible,
  onClose,
  state,
  type,
  counts,
  onStateChange,
  onTypeChange,
}: FilterMenuProps) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.menu, { backgroundColor: theme.backgroundElement }]}>
          {STATES.map((item) => (
            <Pressable
              key={item.value}
              style={({ pressed }) => [
                styles.item,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
              onPress={() => {
                onStateChange(item.value);
                onClose();
              }}
            >
              <Text style={[styles.check, { color: theme.text }]}>
                {state === item.value ? "✓" : " "}
              </Text>
              <Text style={[styles.label, { color: theme.text }]}>{item.label}</Text>
              <Text style={[styles.count, { color: theme.textSecondary }]}>
                {counts?.[item.value] ?? ""}
              </Text>
            </Pressable>
          ))}
          <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />
          {TYPES.map((item) => (
            <Pressable
              key={item.value}
              style={({ pressed }) => [
                styles.item,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
              onPress={() => {
                onTypeChange(item.value);
                onClose();
              }}
            >
              <Text style={[styles.check, { color: theme.text }]}>
                {type === item.value ? "✓" : " "}
              </Text>
              <Text style={[styles.label, { color: theme.text }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "flex-end",
    paddingTop: 100,
    paddingRight: 16,
  },
  menu: {
    minWidth: 230,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    gap: 8,
  },
  check: {
    width: 18,
    fontSize: 15,
  },
  label: {
    flex: 1,
    fontSize: 16,
  },
  count: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
