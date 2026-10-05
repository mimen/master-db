import { createElement, useEffect, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { useActionSheet } from "@/lib/action-sheet";
import { HEADER_FONT, useSignal, type SignalColors } from "./contacts-theme";

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface DropdownOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * The one non-lens choice control: current value plus an up-down chevron.
 * Web overlays a transparent native <select>, so the menu is the platform's
 * own with a check on the current item; iOS uses the native action sheet.
 */
export function ContactsDropdown<T extends string>({ label, value, options, onChange, style }: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly DropdownOption<T>[];
  readonly onChange: (value: T) => void;
  readonly style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const colors = useSignal();
  const showSheet = useActionSheet();
  const current = options.find((o) => o.value === value)?.label ?? "";
  const face = (
    <>
      <Text numberOfLines={1} style={[styles.ddValue, { color: colors.text }]}>{current}</Text>
      <Ionicons name="chevron-expand" size={13} color={colors.icon} />
    </>
  );
  const frame = [styles.dd, { backgroundColor: colors.surface, borderColor: colors.dividerStrong }, style];
  if (Platform.OS === "web") {
    return (
      <View style={frame}>
        {face}
        {createElement("select", {
          "aria-label": label,
          value,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value as T),
          style: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%", font: "inherit" },
        }, options.map((o) => createElement("option", { key: o.value, value: o.value }, o.label)))}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${current}`}
      onPress={() => showSheet({
        title: label,
        actions: options.map((o) => ({ label: o.value === value ? `${o.label} ✓` : o.label, onPress: () => onChange(o.value) })),
      })}
      style={frame}
    >
      {face}
    </Pressable>
  );
}

// TODO(signal-motion): use springs.ts
const SNAPPY = { duration: 220, dampingRatio: 0.9 } as const;

/** The 34x20 Signal switch: ink track when on, the thumb slides on the snappy spring. */
export function ContactsSwitch({ value, onChange, label }: {
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly label: string;
}): React.JSX.Element {
  const colors = useSignal();
  const reduce = useReducedMotion();
  const x = useSharedValue(value ? 14 : 0);
  useEffect(() => {
    x.value = reduce ? (value ? 14 : 0) : withSpring(value ? 14 : 0, SNAPPY);
  }, [value, reduce, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Pressable
      role="switch"
      aria-checked={value}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={({ focused }: { pressed: boolean; focused?: boolean }) => [
        styles.switch,
        { backgroundColor: value ? colors.switchOn : colors.switchOff },
        focused && ({ outlineColor: colors.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: 2 } as object),
      ]}
    >
      <Animated.View style={[styles.thumb, { backgroundColor: value ? colors.sidebar : "#FFFFFF" }, thumb]} />
    </Pressable>
  );
}

export type ButtonTone = "primary" | "secondary" | "ghost";

/** A 30pt text button: primary is ink, secondary is outlined, ghost is bare. */
export function ContactsButton({ label, onPress, tone = "secondary", icon, disabled, testID }: {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly disabled?: boolean;
  readonly testID?: string;
}): React.JSX.Element {
  const colors = useSignal();
  const fg = tone === "primary" ? colors.onPrimary : tone === "ghost" ? colors.textSecondary : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, pressed, focused }: { hovered?: boolean; pressed: boolean; focused?: boolean }) => [
        styles.button,
        tone === "primary" && { backgroundColor: colors.text },
        tone === "secondary" && { backgroundColor: colors.surface, borderColor: colors.dividerStrong, borderWidth: 1 },
        tone !== "primary" && (hovered || pressed) && { backgroundColor: colors.rowHover },
        tone === "primary" && (hovered || pressed) && { opacity: pressed ? 0.8 : 0.9 },
        focused && { outlineColor: colors.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: 1 } as object,
        disabled && { opacity: 0.4 },
      ]}
    >
      {icon && <Ionicons name={icon} size={14} color={fg} />}
      <Text numberOfLines={1} style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** A bare text action in a section header ("Add handle", "Link event", "Make primary"). */
export function TextAction({ label, onPress, accessibilityLabel }: {
  readonly label: string;
  readonly onPress: () => void;
  readonly accessibilityLabel?: string;
}): React.JSX.Element {
  const colors = useSignal();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={6}>
      {({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => (
        <Text style={[styles.textAction, { color: hovered || pressed ? colors.text : colors.textSecondary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SectionHeader({ title, trailing }: { readonly title: string; readonly trailing?: ReactNode }): React.JSX.Element {
  const colors = useSignal();
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      {typeof trailing === "string" || typeof trailing === "number"
        ? <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>{trailing}</Text>
        : trailing}
    </View>
  );
}

export function Card({ children, style, testID }: { readonly children: ReactNode; readonly style?: StyleProp<ViewStyle>; readonly testID?: string }): React.JSX.Element {
  const colors = useSignal();
  return <View testID={testID} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.divider }, style]}>{children}</View>;
}

/** A hairline between card rows. */
export function rowDivider(colors: SignalColors, first: boolean): ViewStyle {
  return first ? {} : { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.divider };
}

/** The detail pane's 48pt bar: "Contacts / Title" with an optional quiet note and trailing controls. */
export function ContactsTopBar({ title, note, trailing, onCrumb }: {
  readonly title: string;
  readonly note?: string;
  readonly trailing?: ReactNode;
  readonly onCrumb?: () => void;
}): React.JSX.Element {
  const colors = useSignal();
  return (
    <View style={[styles.topBar, { borderBottomColor: colors.divider }]} {...DRAG}>
      <Pressable accessibilityRole="link" disabled={!onCrumb} onPress={onCrumb} {...NO_DRAG}>
        <Text style={[styles.crumb, { color: colors.textSecondary }]}>Contacts</Text>
      </Pressable>
      <Text style={[styles.slash, { color: colors.textTertiary }]}>/</Text>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.topTitle, { color: colors.text, fontFamily: HEADER_FONT }]}>{title}</Text>
      {note ? <Text style={[styles.topNote, { color: colors.textTertiary }]}>{note}</Text> : null}
      <View style={styles.flex} />
      <View style={styles.topTrailing} {...NO_DRAG}>{trailing}</View>
    </View>
  );
}

export function IconAction({ icon, label, onPress }: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  const colors = useSignal();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.iconAction, (hovered || pressed) && { backgroundColor: colors.rowHover }]}
    >
      <Ionicons name={icon} size={17} color={colors.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dd: { alignItems: "center", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 8, height: 30, minWidth: 120, paddingLeft: 11, paddingRight: 7, position: "relative" },
  ddValue: { flex: 1, fontSize: 13 },
  button: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 6, height: 30, justifyContent: "center", paddingHorizontal: 12 },
  buttonLabel: { fontSize: 12.5, fontWeight: "600" },
  textAction: { fontSize: 12, fontWeight: "500" },
  sectionHeader: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginHorizontal: 2 },
  sectionTitle: { fontSize: 12, fontWeight: "600" },
  sectionCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  topBar: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", gap: 6, height: 48, paddingLeft: 22, paddingRight: 12 },
  crumb: { fontSize: 13.5 },
  slash: { fontSize: 14, marginHorizontal: 4 },
  topTitle: { flexShrink: 1, fontSize: 15.5, fontWeight: "600", letterSpacing: -0.15 },
  topNote: { fontSize: 12, marginLeft: 8 },
  topTrailing: { alignItems: "center", flexDirection: "row", gap: 2 },
  switch: { borderRadius: 999, height: 20, justifyContent: "center", paddingHorizontal: 2, width: 34 },
  thumb: { borderRadius: 8, height: 16, width: 16 },
  iconAction: { alignItems: "center", borderRadius: 7, height: 30, justifyContent: "center", width: 30 },
});
