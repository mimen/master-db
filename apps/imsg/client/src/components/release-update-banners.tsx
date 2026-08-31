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
  const [failedStagedSha, setFailedStagedSha] = useState<string | null>(null);
  const webReady = webUpdateAvailable(snapshot);
  const shellReady = shellUpdateAvailable(snapshot);
  const restartFailed = shellReady && failedStagedSha === snapshot.shell.stagedSha;

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
            {({ hovered, pressed }) => <Text style={[styles.actionText, { color: hovered || pressed ? theme.text : theme.accent }]}>Reload</Text>}
          </Pressable>
        </View>
      )}
      {shellReady && (
        <View style={[styles.banner, surface]}>
          <Text style={[styles.message, { color: restartFailed ? theme.destructive : theme.text }]}>
            {restartFailed ? "Restart failed" : "Shell update ready"}
          </Text>
          <Text style={[styles.separator, { color: theme.textSecondary }]}>—</Text>
          {restartFailed && (
            <Text style={[styles.bootstrapHint, { color: theme.textSecondary }]}>Run bun run deploy:activate</Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={restartFailed
              ? "Retry staged shell restart"
              : "Restart into staged shell update"}
            disabled={restarting}
            onPress={() => {
              const attemptedSha = snapshot.shell.stagedSha;
              setFailedStagedSha(null);
              setRestarting(true);
              void restartToStagedShell(undefined, attemptedSha ?? undefined).then((started) => {
                if (!started) {
                  setRestarting(false);
                  setFailedStagedSha(attemptedSha);
                }
              });
            }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            {({ hovered, pressed }) => <Text style={[styles.actionText, { color: hovered || pressed ? theme.text : theme.accent }]}>
              {restarting ? "Restarting…" : restartFailed ? "Retry" : "Restart"}
            </Text>}
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
  bootstrapHint: { fontSize: 12, marginRight: 8 },
  action: { minHeight: 30, justifyContent: "center" },
  actionText: { fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.55 },
});
