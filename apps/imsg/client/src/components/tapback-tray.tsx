import { useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle, G, Path } from "react-native-svg";
import type { TapbackType } from "@shared/types";
import { Springs } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";
import { focusRing, focusVisible, type InteractionState } from "@/components/ui/interaction";
import { trayKey } from "@/lib/tapbacks";

export interface TrayTapback {
  type: TapbackType;
  /** Spoken name, e.g. "Love". */
  label: string;
  active: boolean;
  onPress: () => void;
}

const ROUND = { strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
const THUMB =
  "M8.6 10.3 11.3 4.4c.4-.8 1.2-1.2 2-1 1.2.3 1.9 1.5 1.6 2.7l-.8 3.4h4.8c1.5 0 2.6 1.4 2.3 2.8l-1.5 6.9c-.3 1.4-1.5 2.3-2.9 2.3H8.6Z" +
  "M3.2 10.3h3.6v11.2H3.2c-.7 0-1.2-.5-1.2-1.2v-8.8c0-.7.5-1.2 1.2-1.2Z";

/** Monochrome lookalikes of iMessage's six tapback glyphs, drawn on a 24-unit grid. */
export function TapbackGlyph({ type, size, color }: { type: TapbackType; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {type === "love" && (
        <Path
          fill={color}
          d="M12 21.2c-.3 0-.6-.1-.8-.3C5.3 16 2 12.9 2 8.9 2 5.9 4.3 3.5 7.2 3.5c1.9 0 3.6 1 4.8 2.6 1.2-1.6 2.9-2.6 4.8-2.6 2.9 0 5.2 2.4 5.2 5.4 0 4-3.3 7.1-9.2 12-.2.2-.5.3-.8.3Z"
        />
      )}
      {type === "like" && <Path fill={color} d={THUMB} />}
      {type === "dislike" && <Path fill={color} d={THUMB} transform="rotate(180 12 12)" />}
      {type === "laugh" && (
        <G {...ROUND} stroke={color} strokeWidth={2.3} transform="rotate(-12 12 12)">
          <Path d="M2.6 3.6v6.6M6.8 3.6v6.6M2.6 6.9h4.2M9.1 10.2l2.3-6.6 2.3 6.6M10 7.8h2.8" />
          <Path d="M10.3 13.8v6.6M14.5 13.8v6.6M10.3 17.1h4.2M16.8 20.4l2.3-6.6 2.3 6.6M17.7 18h2.8" />
        </G>
      )}
      {type === "emphasize" && (
        <G fill={color}>
          <Path {...ROUND} fill="none" stroke={color} strokeWidth={3.4} d="M8.4 4.2v9.4M15.6 4.2v9.4" />
          <Circle cx={8.4} cy={19} r={2} />
          <Circle cx={15.6} cy={19} r={2} />
        </G>
      )}
      {type === "question" && (
        <G fill={color}>
          <Path
            {...ROUND}
            stroke={color}
            strokeWidth={3.2}
            d="M7.6 8.6c0-2.6 2-4.4 4.4-4.4s4.4 1.6 4.4 4c0 2.2-1.5 3-2.8 3.8-1 .6-1.6 1.3-1.6 2.7v.4"
          />
          <Circle cx={12} cy={19.4} r={2} />
        </G>
      )}
    </Svg>
  );
}

/**
 * The tapback tray: one capsule of the six tapbacks. It springs up from below, and Reduce
 * Motion lands it at rest. On the web the arrows move between tapbacks, Enter picks, and
 * Escape closes. No per-button `entering` animation: Reanimated hides those nodes until
 * the animation starts, and the browser drops the opening focus() on a hidden button.
 */
export function TapbackTray({
  tapbacks,
  size = "compact",
  onDone,
}: {
  tapbacks: readonly TrayTapback[];
  /** `touch` is the phone sheet's 44pt target; `compact` the desktop popover's. */
  size?: "compact" | "touch";
  onDone: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  const buttons = useRef<(View | null)[]>([]);
  const pick = (tapback: TrayTapback) => {
    onDone();
    tapback.onPress();
  };
  const keyState = useRef({ tapbacks, pick, onDone });
  useEffect(() => {
    keyState.current = { tapbacks, pick, onDone };
  });

  useEffect(() => {
    shown.value = reduceMotion ? 1 : withSpring(1, Springs.snappy);
  }, [reduceMotion, shown]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const nodes = () => buttons.current as unknown as (HTMLElement | null)[];
    nodes()[Math.max(keyState.current.tapbacks.findIndex((t) => t.active), 0)]?.focus();
    // Window capture runs ahead of the app's document-level shortcuts, so arrows,
    // Enter and Escape act on the tray instead of the conversation list.
    const onKey = (event: KeyboardEvent): void => {
      const s = keyState.current;
      const focused = nodes().findIndex((node) => node === document.activeElement);
      const result = trayKey(event.key, focused, s.tapbacks.length);
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      if (result.kind === "move") nodes()[result.index]?.focus();
      else if (result.kind === "pick") s.pick(s.tapbacks[result.index]!);
      else s.onDone();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const entrance = useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.value),
    transform: [{ translateY: 6 * (1 - shown.value) }, { scale: 0.92 + 0.08 * shown.value }],
  }));
  const touch = size === "touch";
  const button = touch ? styles.touch : styles.compact;
  const glyph = touch ? 24 : 20;

  return (
    <Reanimated.View
      role="toolbar"
      aria-label="Tapbacks"
      style={[styles.tray, { backgroundColor: theme.popBg, boxShadow: theme.popShadow }, entrance]}
    >
      {tapbacks.map((tapback, i) => (
        <Pressable
          key={tapback.type}
          ref={(node) => {
            buttons.current[i] = node;
          }}
          accessibilityRole="button"
          accessibilityLabel={tapback.active ? `Remove ${tapback.label}` : tapback.label}
          aria-selected={tapback.active}
          onPress={() => pick(tapback)}
          style={(state: InteractionState) => [
            button,
            tapback.active
              ? { backgroundColor: theme.accent }
              : (state.hovered || state.pressed) && { backgroundColor: theme.popSelected },
            state.pressed && { transform: [{ scale: 0.9 }] },
            focusVisible(state) && focusRing(theme),
          ]}
        >
          <TapbackGlyph type={tapback.type} size={glyph} color={tapback.active ? theme.onAccent : theme.icon} />
        </Pressable>
      ))}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  tray: {
    borderRadius: 999,
    flexDirection: "row",
    gap: 2,
    padding: 4,
  },
  compact: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  touch: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
});
