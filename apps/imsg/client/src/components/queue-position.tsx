import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useQueuePosition } from "@/hooks/use-queue-position";
import { useTheme } from "@/hooks/use-theme";
import { runCommand } from "@/lib/keyboard/controller";

/** "2 of 41" with previous (K) and next (J), for the thread top bar. Absent outside a lens. */
export function QueuePosition() {
  const position = useQueuePosition();
  const theme = useTheme();
  if (!position) return null;
  const step = (label: string, icon: "chevron-up" | "chevron-down", command: "conversation.previous" | "conversation.next", disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => runCommand(command, "button")}
      hitSlop={6}
      style={({ hovered, pressed }) => [
        styles.step,
        disabled && styles.disabled,
        !disabled && hovered && !pressed && { backgroundColor: theme.backgroundElement },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Ionicons name={icon} size={17} color={theme.textSecondary} />
    </Pressable>
  );
  return (
    <View style={styles.wrap}>
      <Text
        accessibilityLabel={`Conversation ${position.index} of ${position.total}`}
        style={[styles.count, { color: theme.textSecondary }]}
      >
        {position.index} of {position.total}
      </Text>
      {step("Previous conversation (K)", "chevron-up", "conversation.previous", position.index <= 1)}
      {step("Next conversation (J)", "chevron-down", "conversation.next", position.index >= position.total)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", flexDirection: "row", gap: 2, marginRight: 6 },
  count: { fontSize: 12.5, fontVariant: ["tabular-nums"], marginRight: 6 },
  step: { alignItems: "center", borderRadius: 8, height: 28, justifyContent: "center", width: 28 },
  disabled: { opacity: 0.35 },
});
