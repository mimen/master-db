import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { isServerReachable, subscribeReachable } from "@/lib/api";
import { isStreamLive, reconnectStream, subscribeStreamLive } from "@/lib/sse";
import { useTheme } from "@/hooks/use-theme";
import { Type } from "@/constants/theme";

/**
 * Says the Mini is unreachable instead of leaving a spinner or a stale list
 * with no explanation. Deliberately only shown for a hard failure: a live
 * stream means we are connected, whatever a single request did.
 */
export function ConnectionBanner() {
  const theme = useTheme();
  const reachable = useSyncExternalStore(subscribeReachable, isServerReachable, () => true);
  const live = useSyncExternalStore(subscribeStreamLive, isStreamLive, () => true);

  if (reachable || live) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Reconnect to the server"
      onPress={reconnectStream}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.text, { color: theme.textSecondary }]}>
        Can&rsquo;t reach the server &middot; tap to retry
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  text: {
    fontSize: Type.caption,
    fontWeight: "500",
  },
});
