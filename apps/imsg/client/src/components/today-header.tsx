import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { useTheme } from "@/hooks/use-theme";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { builtLine, busyCopy, todayDate, todayTime, type TodayBusy, type TodayHeader, type TodayMode } from "@/lib/today";

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

function ChevronIcon({ color }: { readonly color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <Path d="M2.5 4l2.5 2.5L7.5 4" />
    </Svg>
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

/** Requests an Update. Inside the split control it is the left segment and the pill draws the border. */
function UpdateButton({ label, busy, onPress, colors, segment = false }: {
  readonly label: string; readonly busy: TodayBusy | null; readonly onPress: () => void; readonly colors: Colors; readonly segment?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const shown = busy ? busyCopy(busy).label : label;
  const resting = segment ? "transparent" : colors.chipBg;
  return (
    <Pressable
      testID="today-update"
      accessibilityRole="button"
      accessibilityLabel={`${shown} today's queue`}
      accessibilityState={{ disabled: busy !== null, busy: busy !== null }}
      disabled={busy !== null}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.button, segment ? null : [styles.chip, { borderColor: colors.chipBorder }], { backgroundColor: hovered && !busy ? colors.rowHover : resting }]}
    >
      <RegenerateIcon color={busy ? colors.textTertiary : colors.text} spinning={busy !== null} />
      <Text style={[styles.buttonText, { color: busy ? colors.textTertiary : colors.text }]}>{shown}</Text>
    </Pressable>
  );
}

/** Update, with Regenerate from scratch one menu away: one bordered pill, a hairline between the segments. */
function BuildControl({ busy, onRequest, colors }: { readonly busy: TodayBusy | null; readonly onRequest: (mode: TodayMode) => void; readonly colors: Colors }) {
  const showSheet = useActionSheet();
  const [hovered, setHovered] = useState(false);
  const disabled = busy !== null;
  return (
    <View style={[styles.chip, styles.split, { borderColor: colors.chipBorder, backgroundColor: colors.chipBg }]}>
      <UpdateButton label="Update" busy={busy} onPress={() => onRequest("update")} colors={colors} segment />
      <View style={[styles.divider, { backgroundColor: colors.chipBorder }]} />
      <Pressable
        testID="today-build-menu"
        accessibilityRole="button"
        accessibilityLabel="More ways to build today's queue"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={(event) => showSheet({
          anchor: { ...pressAnchor(event), align: "end" },
          actions: [{ label: "Regenerate from scratch", icon: "refresh", note: "New session: rereads the inbox and re-ranks everything", onPress: () => onRequest("fresh") }],
        })}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.menu, { backgroundColor: hovered && !disabled ? colors.rowHover : "transparent" }]}
      >
        <ChevronIcon color={disabled ? colors.textTertiary : colors.text} />
      </Pressable>
    </View>
  );
}

/** The Today lens's plan card: the date, Update, what was built, the brief and the day's progress. */
export function TodayHeaderCard({ header, dayStart, onRequest }: {
  readonly header: TodayHeader;
  readonly dayStart: number;
  readonly onRequest: (mode: TodayMode) => void;
}) {
  const colors = useTheme();
  if (header.kind === "loading") return null;
  const { busy } = header;
  const busyText = busy ? busyCopy(busy) : null;
  const date = todayDate(dayStart);
  const card = [styles.plan, { backgroundColor: colors.backgroundElement }];
  // Before today's first queue, Build now and Retry are Updates too: the worker continues yesterday's session if it can.
  const update = () => onRequest("update");

  if (header.kind === "unbuilt") {
    return (
      <View testID="today-header" style={card}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: colors.text }]}>{date}</Text>
          {busy ? <UpdateButton label="Build now" busy={busy} onPress={update} colors={colors} /> : (
            <Pressable testID="today-update" accessibilityRole="button" accessibilityLabel="Build today's queue now" onPress={update}
              style={({ hovered, pressed }) => [styles.solid, { backgroundColor: colors.swipeSettle, opacity: hovered || pressed ? 0.85 : 1 }]}>
              <Text style={[styles.buttonText, { color: colors.background }]}>Build now</Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>{busyText ? busyText.meta : "Today's queue builds at 7:00 AM"}</Text>
        {busyText ? <Progress fraction={0} busy label={busyText.label} colors={colors} /> : null}
      </View>
    );
  }

  if (header.kind === "failed") {
    return (
      <View testID="today-header" style={card}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: busy ? colors.text : colors.destructive }]}>{busy ? date : "Couldn't build today's queue"}</Text>
          <UpdateButton label="Retry" busy={busy} onPress={update} colors={colors} />
        </View>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>{busyText ? busyText.meta : `${header.error} at ${todayTime(header.failedAt)}`}</Text>
        {busyText ? <Progress fraction={0} busy label={busyText.label} colors={colors} /> : null}
      </View>
    );
  }

  const total = header.settled + header.toGo;
  const meta = busyText ? busyText.meta
    : header.cleared ? `${header.settled} settled today${header.newSince ? ` · ${header.newSince} new since ${todayTime(header.builtAt)}` : ""}`
    : builtLine(header);
  return (
    <View testID="today-header" style={card}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: colors.text }]}>{header.cleared && !busy ? "Queue cleared" : date}</Text>
        <BuildControl busy={busy} onRequest={onRequest} colors={colors} />
      </View>
      <Text testID="today-meta" style={[styles.meta, { color: colors.textTertiary }]}>{meta}</Text>
      {header.lastError && !busy ? (
        <Text style={[styles.meta, { color: colors.destructive }]}>{header.lastError}</Text>
      ) : null}
      {header.cleared ? null : (
        <Text testID="today-brief" style={[styles.brief, { color: colors.textSecondary, opacity: busy ? 0.45 : 1 }]}>{header.brief}</Text>
      )}
      <Progress fraction={total ? header.settled / total : 1} busy={busy !== null} label={`${header.settled} settled · ${header.toGo} to go`} colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create({
  plan: { borderRadius: 12, marginBottom: 6, marginHorizontal: 2, marginTop: 10, paddingBottom: 11, paddingHorizontal: 12, paddingTop: 12 },
  top: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 13, fontWeight: "600" },
  meta: { fontSize: 11.5, fontVariant: ["tabular-nums"], marginTop: 2 },
  brief: { fontSize: 12.5, lineHeight: 17, marginTop: 9 },
  chip: { borderRadius: 7, borderWidth: 1 },
  button: { alignItems: "center", flexDirection: "row", gap: 5, paddingBottom: 3, paddingLeft: 7, paddingRight: 8, paddingTop: 3 },
  buttonText: { fontSize: 12, fontWeight: "600" },
  split: { alignItems: "stretch", flexDirection: "row", overflow: "hidden" },
  divider: { width: StyleSheet.hairlineWidth },
  menu: { alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  solid: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 4 },
  progress: { alignItems: "center", flexDirection: "row", gap: 9, marginTop: 10 },
  bar: { borderRadius: 2, flex: 1, height: 4, overflow: "hidden" },
  fill: { borderRadius: 2, bottom: 0, left: 0, position: "absolute", top: 0 },
  progressLabel: { marginTop: 0 },
});
