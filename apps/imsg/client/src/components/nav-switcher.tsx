import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/hooks/use-theme";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

/**
 * Desktop-only segmented control between the two primary destinations.
 * Mobile gets a real bottom tab bar instead (see app/(tabs)/_layout.tsx) —
 * this is the wide-layout equivalent, since a native tab bar reads oddly on
 * a desktop-width web page.
 */
export function NavSwitcher({
  active,
  style,
}: {
  active: "messages" | "contacts";
  /** Override the outer container — e.g. drop the margins to sit inline in a top bar. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundElement }, style]}
      {...NO_DRAG}
    >
      <Segment
        label="Messages"
        selected={active === "messages"}
        onPress={() => router.push("/")}
      />
      <Segment
        label="Contacts"
        selected={active === "contacts"}
        onPress={() => router.push("/contacts")}
      />
    </View>
  );
}

function Segment({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.segment,
        selected && { backgroundColor: theme.background },
        !selected && hovered && !pressed && { backgroundColor: theme.backgroundSelected },
        !selected && pressed && { backgroundColor: theme.backgroundSelected, opacity: 0.85 },
        Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.label, { color: selected ? theme.text : theme.textSecondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    flexDirection: "row",
    flexShrink: 1,
    minWidth: 0,
    padding: 2,
  },
  segment: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: { fontSize: 12, fontWeight: "600" },
});
