import { StyleSheet, Text, View } from "react-native";
import type { Service } from "@/lib/contact-service";
import { useTheme } from "@/hooks/use-theme";

/** The service dot and name shown beside a handle: blue iMessage, green SMS. */
export function ServiceLabel({ service, size = 11.5 }: { service: Service; size?: number }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: service === "SMS" ? theme.sms : theme.bubbleMine }]} />
      <Text style={[styles.label, { color: theme.textSecondary, fontSize: size }]}>{service}</Text>
    </View>
  );
}

export function ServiceDot({ service }: { service: Service }): React.JSX.Element {
  const theme = useTheme();
  return <View style={[styles.dot, { backgroundColor: service === "SMS" ? theme.sms : theme.bubbleMine }]} />;
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 5 },
  dot: { borderRadius: 999, height: 7, width: 7 },
  label: { fontWeight: "500" },
});
