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
        <Text style={[styles.label, { color: active === "messages" ? theme.text : theme.textSecondary }]}>
          Messages
        </Text>
      </Pressable>
      <Pressable
        style={[styles.segment, active === "contacts" && { backgroundColor: theme.background }]}
        onPress={() => router.push("/contacts")}
      >
        <Text style={[styles.label, { color: active === "contacts" ? theme.text : theme.textSecondary }]}>
          Contacts
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 8,
  },
  label: { fontSize: 14, fontWeight: "600" },
});
