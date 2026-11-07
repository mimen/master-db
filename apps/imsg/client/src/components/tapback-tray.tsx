import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle, G, Path } from "react-native-svg";
import { keyEmoji } from "@shared/platform-profile";
import type { TapbackType } from "@shared/types";
import { Springs } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";
import { focusRing, focusVisible, type InteractionState } from "@/components/ui/interaction";
import { firstEmoji, QUICK_EMOJI, trayKey } from "@/lib/tapbacks";
import { showToast } from "@/lib/toast";

export interface TrayTapback {
  /** The reaction key it sends: a tapback name, or `emoji:` and an emoji. */
  key: string;
  /** Spoken name, e.g. "Love". */
  label: string;
  active: boolean;
  onPress: () => void;
}

/** The tray's emoji picker. `unavailable` greys its button with the reason. */
export interface TrayEmoji {
  onPick: (emoji: string) => void;
  unavailable?: string;
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

function SmileyPlus({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <G {...ROUND} stroke={color} strokeWidth={1.9}>
        <Path d="M20.4 12.6A8.4 8.4 0 1 1 11.4 3.6" />
        <Path d="M8.2 14.4c.9 1.3 2.2 2 3.8 2s2.9-.7 3.8-2M18.5 2.8v6M15.5 5.8h6" />
      </G>
      <Circle cx={9} cy={10} r={1.2} fill={color} />
      <Circle cx={15} cy={10} r={1.2} fill={color} />
    </Svg>
  );
}

/**
 * The tapback tray: one capsule of the route's tapbacks, my emoji reaction when I have one, and a button that
 * opens the emoji picker. It springs up from below, and Reduce Motion lands it at rest. On the web the arrows
 * move between buttons, Enter picks, and Escape closes. No per-button `entering` animation: Reanimated hides
 * those nodes until the animation starts, and the browser drops the opening focus() on a hidden button.
 */
export function TapbackTray({
  tapbacks,
  emoji,
  size = "compact",
  unavailable,
  onDone,
}: {
  tapbacks: readonly TrayTapback[];
  emoji?: TrayEmoji;
  /** Why this conversation can't react. The tray stays, greyed with the reason, and a pick only repeats it. */
  unavailable?: string;
  /** `touch` is the phone sheet's 44pt target; `compact` the desktop popover's. */
  size?: "compact" | "touch";
  onDone: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  const buttons = useRef<(View | null)[]>([]);
  const [picking, setPicking] = useState(false);
  const emojiUnavailable = unavailable ?? emoji?.unavailable;
  const count = tapbacks.length + (emoji ? 1 : 0);
  const pick = (index: number) => {
    const tapback = tapbacks[index];
    const reason = tapback ? unavailable : emojiUnavailable;
    if (reason) {
      showToast(reason);
      return;
    }
    if (!tapback) {
      setPicking(true);
      return;
    }
    onDone();
    tapback.onPress();
  };
  const pickEmoji = (value: string) => {
    onDone();
    emoji?.onPick(value);
  };
  const keyState = useRef({ tapbacks, count, picking, pick, onDone });
  useEffect(() => {
    keyState.current = { tapbacks, count, picking, pick, onDone };
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
      if (s.picking && event.key !== "Escape") return;
      const focused = nodes().findIndex((node) => node === document.activeElement);
      const result = trayKey(event.key, focused, s.count);
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      if (result.kind === "move") nodes()[result.index]?.focus();
      else if (result.kind === "pick") s.pick(result.index);
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
  const buttonStyle = (active: boolean, greyed: boolean) => (state: InteractionState) => [
    button,
    active && !greyed
      ? { backgroundColor: theme.accent }
      : (state.hovered || state.pressed) && { backgroundColor: theme.popSelected },
    state.pressed && { transform: [{ scale: 0.9 }] },
    focusVisible(state) && focusRing(theme),
  ];

  if (picking && emoji) {
    return <EmojiPicker size={size} onPick={pickEmoji} />;
  }

  return (
    <Reanimated.View
      role="toolbar"
      aria-label="Tapbacks"
      aria-disabled={unavailable ? true : undefined}
      style={[styles.tray, { backgroundColor: theme.popBg, boxShadow: theme.popShadow }, entrance]}
    >
      {tapbacks.map((tapback, i) => {
        const shownEmoji = keyEmoji(tapback.key);
        const color = unavailable ? theme.disabled : tapback.active ? theme.onAccent : theme.icon;
        return (
          <Pressable
            key={tapback.key}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            accessibilityRole="button"
            accessibilityLabel={tapback.active ? `Remove ${tapback.label}` : tapback.label}
            accessibilityHint={unavailable}
            accessibilityState={{ disabled: !!unavailable }}
            aria-selected={tapback.active}
            onPress={() => pick(i)}
            style={buttonStyle(tapback.active, !!unavailable)}
          >
            {shownEmoji
              ? <Text style={[styles.emoji, { fontSize: glyph - 2, opacity: unavailable ? 0.4 : 1 }]}>{shownEmoji}</Text>
              : <TapbackGlyph type={tapback.key as TapbackType} size={glyph} color={color} />}
          </Pressable>
        );
      })}
      {emoji && (
        <Pressable
          ref={(node) => {
            buttons.current[tapbacks.length] = node;
          }}
          accessibilityRole="button"
          accessibilityLabel="More reactions"
          accessibilityHint={emojiUnavailable}
          accessibilityState={{ disabled: !!emojiUnavailable }}
          onPress={() => pick(tapbacks.length)}
          style={buttonStyle(false, !!emojiUnavailable)}
        >
          <SmileyPlus size={glyph} color={emojiUnavailable ? theme.disabled : theme.icon} />
        </Pressable>
      )}
      {unavailable && <Text style={[styles.reason, { color: theme.popTertiary }]}>{unavailable}</Text>}
    </Reanimated.View>
  );
}

/** Quick emoji, then a field for any other: the phone's emoji keyboard, or the Mac's character viewer (⌃⌘Space). */
function EmojiPicker({ size, onPick }: { size: "compact" | "touch"; onPick: (emoji: string) => void }) {
  const theme = useTheme();
  const touch = size === "touch";
  const cell = touch ? styles.touch : styles.compact;
  return (
    <View role="dialog" aria-label="Emoji reactions" style={[styles.picker, { backgroundColor: theme.popBg, boxShadow: theme.popShadow }]}>
      <TextInput
        autoFocus
        accessibilityLabel="Any emoji"
        placeholder="Type or paste any emoji"
        placeholderTextColor={theme.popTertiary}
        style={[styles.field, { color: theme.text, borderColor: theme.divider }]}
        onChangeText={(text) => {
          const picked = firstEmoji(text);
          if (picked) onPick(picked);
        }}
      />
      <View style={styles.grid}>
        {QUICK_EMOJI.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={value}
            onPress={() => onPick(value)}
            style={(state: InteractionState) => [
              cell,
              (state.hovered || state.pressed) && { backgroundColor: theme.popSelected },
              focusVisible(state) && focusRing(theme),
            ]}
          >
            <Text style={[styles.emoji, { fontSize: touch ? 22 : 18 }]}>{value}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emoji: {
    textAlign: "center",
  },
  field: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  },
  picker: {
    borderRadius: 18,
    padding: 8,
    width: 8 * 36 + 7 * 2 + 16,
  },
  reason: {
    alignSelf: "center",
    fontSize: 11.5,
    paddingHorizontal: 8,
  },
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
