import { StyleSheet, Text, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { Service } from "@/lib/contact-service";

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = {
  light: { bubbleMine: "#007AFF", bubbleSms: "#34C759", textSecondary: "#55555C" },
  dark: { bubbleMine: "#0A84FF", bubbleSms: "#30D158", textSecondary: "#A6A6AD" },
} as const;

/** The service dot and name shown beside a handle: blue iMessage, green SMS. */
export function ServiceLabel({ service, size = 11.5 }: { service: Service; size?: number }): React.JSX.Element {
  const signal = SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: service === "SMS" ? signal.bubbleSms : signal.bubbleMine }]} />
      <Text style={[styles.label, { color: signal.textSecondary, fontSize: size }]}>{service}</Text>
    </View>
  );
}

export function ServiceDot({ service }: { service: Service }): React.JSX.Element {
  const signal = SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
  return <View style={[styles.dot, { backgroundColor: service === "SMS" ? signal.bubbleSms : signal.bubbleMine }]} />;
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 5 },
  dot: { borderRadius: 999, height: 7, width: 7 },
  label: { fontWeight: "500" },
});
