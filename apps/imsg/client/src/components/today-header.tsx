import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "@/hooks/use-theme";
import { todayDate, todayTime, type TodayHeader } from "@/lib/today";

type Colors = ReturnType<typeof useTheme>;

function RegenerateIcon({ color, spinning }: { readonly color: string; readonly spinning: boolean }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!spinning || reduceMotion) return;
    turn.value = 0;
    turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [spinning, reduceMotion, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Reanimated.View style={spinning ? spin : null}>
      <Svg width={12} height={12} viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" aria-hidden>
        <Path d="M12 7a5 5 0 1 1-1.5-3.6" />
        <Path d="M12 2v3H9" />
      </Svg>
    </Reanimated.View>
  );
}

/** The mock's indeterminate bar: a 30% sliver sweeping left to right while a build runs. */
function Progress({ fraction, busy, label, colors }: { readonly fraction: number; readonly busy: boolean; readonly label: string; readonly colors: Colors }) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (!busy || reduceMotion) return;
    sweep.value = 0;
    sweep.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1);
    return () => cancelAnimation(sweep);
  }, [busy, reduceMotion, sweep]);
  const sliver = useAnimatedStyle(() => ({ transform: [{ translateX: (sweep.value * 1.3 - 0.3) * width }] }));
  return (
    <View style={styles.progress}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[styles.bar, { backgroundColor: colors.dividerStrong }]}>
        {busy
          ? <Reanimated.View style={[styles.fill, { width: "30%", backgroundColor: colors.swipeSettle }, sliver]} />
          : <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: colors.swipeSettle }]} />}
      </View>
      <Text testID="today-progress" style={[styles.meta, styles.progressLabel, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

function RegenerateButton({ label, busy, onPress, colors }: { readonly label: string; readonly busy: boolean; readonly onPress: () => void; readonly colors: Colors }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      testID="today-regenerate"
      accessibilityRole="button"
      accessibilityLabel={busy ? "Regenerating today's queue" : `${label} today's queue`}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.regenerate, { borderColor: colors.chipBorder, backgroundColor: hovered && !busy ? colors.rowHover : colors.chipBg }]}
    >
      <RegenerateIcon color={busy ? colors.textTertiary : colors.text} spinning={busy} />
      <Text style={[styles.regenerateText, { color: busy ? colors.textTertiary : colors.text }]}>{busy ? "Regenerating" : label}</Text>
    </Pressable>
  );
}

const BUILDING_META = "Reading threads with Opus 5.5…";

/** The Today lens's plan card: the date, Regenerate, what was built, the brief and the day's progress. */
export function TodayHeaderCard({ header, dayStart, onRegenerate }: {
  readonly header: TodayHeader;
  readonly dayStart: number;
  readonly onRegenerate: () => void;
}) {
  const colors = useTheme();
  if (header.kind === "loading") return null;
  const busy = header.busy !== null;
  const date = todayDate(dayStart);
  const card = [styles.plan, { backgroundColor: colors.backgroundElement }];

  if (header.kind === "unbuilt") {
    return (
      <View testID="today-header" style={card}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: colors.text }]}>{date}</Text>
          {busy ? <RegenerateButton label="Build now" busy onPress={onRegenerate} colors={colors} /> : (
            <Pressable testID="today-regenerate" accessibilityRole="button" accessibilityLabel="Build today's queue now" onPress={onRegenerate}
              style={({ hovered, pressed }) => [styles.solid, { backgroundColor: colors.swipeSettle, opacity: hovered || pressed ? 0.85 : 1 }]}>
              <Text style={[styles.regenerateText, { color: colors.background }]}>Build now</Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>{busy ? BUILDING_META : "Today's queue builds at 7:00 AM"}</Text>
        {busy ? <Progress fraction={0} busy label="Regenerating" colors={colors} /> : null}
      </View>
    );
  }

  if (header.kind === "failed") {
    return (
      <View testID="today-header" style={card}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: busy ? colors.text : colors.destructive }]}>{busy ? date : "Couldn't build today's queue"}</Text>
          <RegenerateButton label="Retry" busy={busy} onPress={onRegenerate} colors={colors} />
        </View>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>{busy ? BUILDING_META : `${header.error} at ${todayTime(header.failedAt)}`}</Text>
        {busy ? <Progress fraction={0} busy label="Regenerating" colors={colors} /> : null}
      </View>
    );
  }

  const total = header.settled + header.toGo;
  const built = todayTime(header.builtAt);
  const meta = busy ? BUILDING_META
    : header.cleared ? `${header.settled} settled today${header.newSince ? ` · ${header.newSince} new since ${built}` : ""}`
    : `Built ${built} · ${header.model} · ${header.queued} of ${header.readCount} threads`;
  return (
    <View testID="today-header" style={card}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: colors.text }]}>{header.cleared && !busy ? "Queue cleared" : date}</Text>
        <RegenerateButton label="Regenerate" busy={busy} onPress={onRegenerate} colors={colors} />
      </View>
      <Text testID="today-meta" style={[styles.meta, { color: colors.textTertiary }]}>{meta}</Text>
      {header.lastError && !busy ? (
        <Text style={[styles.meta, { color: colors.destructive }]}>Regenerate failed: {header.lastError}</Text>
      ) : null}
      {header.cleared ? null : (
        <Text testID="today-brief" style={[styles.brief, { color: colors.textSecondary, opacity: busy ? 0.45 : 1 }]}>{header.brief}</Text>
      )}
      <Progress fraction={total ? header.settled / total : 1} busy={busy} label={`${header.settled} settled · ${header.toGo} to go`} colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create({
  plan: { borderRadius: 12, marginBottom: 6, marginHorizontal: 2, marginTop: 10, paddingBottom: 11, paddingHorizontal: 12, paddingTop: 12 },
  top: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 13, fontWeight: "600" },
  meta: { fontSize: 11.5, fontVariant: ["tabular-nums"], marginTop: 2 },
  brief: { fontSize: 12.5, lineHeight: 17, marginTop: 9 },
  regenerate: { alignItems: "center", borderRadius: 7, borderWidth: 1, flexDirection: "row", gap: 5, paddingBottom: 3, paddingLeft: 7, paddingRight: 8, paddingTop: 3 },
  regenerateText: { fontSize: 12, fontWeight: "600" },
  solid: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 4 },
  progress: { alignItems: "center", flexDirection: "row", gap: 9, marginTop: 10 },
  bar: { borderRadius: 2, flex: 1, height: 4, overflow: "hidden" },
  fill: { borderRadius: 2, bottom: 0, left: 0, position: "absolute", top: 0 },
  progressLabel: { marginTop: 0 },
});
