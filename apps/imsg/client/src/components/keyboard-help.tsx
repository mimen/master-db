import type { JSX } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { helpEntries } from "@/lib/keyboard/registry";

const HELP_ENTRIES = helpEntries();

/** The ⌘/ shortcut list. Its own chunk: it shows only when asked for. */
export function KeyboardHelp(): JSX.Element {
  const theme = useTheme();
  return (
    <>
      <Text style={[styles.helpTitle, { color: theme.text }]}>Keyboard Shortcuts</Text>
      {HELP_ENTRIES.map(({ title, keys }) => (
        <View key={title} style={styles.helpRow}>
          <Text style={[styles.helpLabel, { color: theme.textSecondary }]}>{title}</Text>
          <View style={styles.helpKeys}>
            {keys.map((key) => (
              <View
                key={key}
                style={[styles.kbd, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}
              >
                <Text style={[styles.kbdText, { color: theme.text }]}>{key}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  helpKeys: {
    flexDirection: "row",
    gap: 5,
  },
  helpLabel: {
    flex: 1,
    fontSize: Type.secondary,
  },
  helpRow: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 10,
  },
  helpTitle: {
    fontSize: Type.title,
    fontWeight: "700",
    marginBottom: 14,
  },
  kbd: {
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  kbdText: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
});
