import { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

/** Pulsing placeholder rows shown while the chat list first loads. */
export function SkeletonList({ rows = 9 }: { rows?: number }) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 700,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.dotColumn} />
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]} />
          <View style={styles.lines}>
            <View style={[styles.line, { width: "45%", backgroundColor: theme.backgroundElement }]} />
            <View style={[styles.line, { width: "80%", backgroundColor: theme.backgroundElement }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 75,
    paddingRight: 16,
  },
  dotColumn: {
    width: 17,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  lines: {
    flex: 1,
    gap: 7,
    marginLeft: 11,
  },
  line: {
    height: 11,
    borderRadius: 6,
  },
});
