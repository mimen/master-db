import { shellUpdateAvailable, webUpdateAvailable } from "@shared/release-identity";
import { useState, useSyncExternalStore, type JSX } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Radii, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { reloadWebClient } from "@/lib/deploy-reload";
import { restartToStagedShell } from "@/lib/desktop-shell";
import { releaseStatus } from "@/lib/release-status";

export function ReleaseUpdateBanners(): JSX.Element | null {
  const theme = useTheme();
  const snapshot = useSyncExternalStore(
    releaseStatus.subscribe,
    releaseStatus.getSnapshot,
    releaseStatus.getSnapshot,
  );
  const [restarting, setRestarting] = useState(false);
  const webReady = webUpdateAvailable(snapshot);
  const shellReady = shellUpdateAvailable(snapshot);

  if (!webReady && !shellReady) return null;

  const surface = {
    backgroundColor: theme.backgroundElement,
    borderColor: theme.divider,
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
      style={styles.stack}
      testID="release-update-banners"
    >
      {webReady && (
        <View style={[styles.banner, surface]}>
          <Text style={[styles.message, { color: theme.text }]}>Web update ready</Text>
          <Text style={[styles.separator, { color: theme.textSecondary }]}>—</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload web update"
            onPress={() => reloadWebClient()}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={[styles.actionText, { color: theme.accent }]}>Reload</Text>
          </Pressable>
        </View>
      )}
      {shellReady && (
        <View style={[styles.banner, surface]}>
          <Text style={[styles.message, { color: theme.text }]}>Shell update ready</Text>
          <Text style={[styles.separator, { color: theme.textSecondary }]}>—</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Restart into staged shell update"
            disabled={restarting}
            onPress={() => {
              setRestarting(true);
              void restartToStagedShell().then((started) => {
                if (!started) setRestarting(false);
              });
            }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={[styles.actionText, { color: theme.accent }]}>
              {restarting ? "Restarting…" : "Restart"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: "center",
    gap: Spacing.two,
    left: 0,
    position: "absolute",
    right: 0,
    top: 10,
    zIndex: 1000,
  },
  banner: {
    alignItems: "center",
    borderRadius: Radii.chip,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 34,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  message: { fontSize: 12, fontWeight: "600" },
  separator: { fontSize: 12, marginHorizontal: 5 },
  action: { minHeight: 30, justifyContent: "center" },
  actionText: { fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.55 },
});
