import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/hooks/use-theme";

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
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }, style]}>
      <Pressable
        style={[styles.segment, active === "messages" && { backgroundColor: theme.background }]}
        onPress={() => router.push("/")}
      >
        <Text
          numberOfLines={1}
          style={[styles.label, { color: active === "messages" ? theme.text : theme.textSecondary }]}
        >
          Messages
        </Text>
      </Pressable>
      <Pressable
        style={[styles.segment, active === "contacts" && { backgroundColor: theme.background }]}
        onPress={() => router.push("/contacts")}
      >
        <Text
          numberOfLines={1}
          style={[styles.label, { color: active === "contacts" ? theme.text : theme.textSecondary }]}
        >
          Contacts
        </Text>
      </Pressable>
    </View>
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
