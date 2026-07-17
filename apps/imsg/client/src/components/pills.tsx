import { Pressable, StyleSheet, Text, View } from "react-native";
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

function Pill({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        { backgroundColor: active ? theme.text : theme.backgroundElement },
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          { color: active ? theme.background : theme.textSecondary },
        ]}
      >
        {label}
        {count !== undefined ? `  ${count > 999 ? "999+" : count}` : ""}
      </Text>
    </Pressable>
  );
}

interface PillBarProps {
  state: StateFilter;
  type: TypeFilter;
  counts: StateCounts | null;
  onStateChange: (state: StateFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
}

/** Always-visible filter pills for the wide/desktop layout. */
export function PillBar({ state, type, counts, onStateChange, onTypeChange }: PillBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {STATES.map((item) => (
          <Pill
            key={item.value}
            label={item.label}
            count={counts?.[item.value]}
            active={state === item.value}
            onPress={() => onStateChange(item.value)}
          />
        ))}
      </View>
      <View style={styles.row}>
        {TYPES.map((item) => (
          <Pill
            key={item.value}
            label={item.label}
            active={type === item.value}
            onPress={() => onTypeChange(item.value)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
});
