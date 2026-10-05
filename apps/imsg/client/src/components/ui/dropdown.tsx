import { Ionicons } from "@expo/vector-icons";
import { useEffect, useId, useRef, useState, type JSX } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Radius } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { useSignalColors } from "@/lib/signal-colors";

import { initialIndex, menuKey, placeMenu, type Rect } from "./dropdown-model";
import { focusVisible, type InteractionState } from "./interaction";

export interface DropdownOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  /** Quiet text after the label, in the field and the menu ("Opus Claude"). */
  readonly detail?: string;
  /** A line under the label in the menu only. */
  readonly description?: string;
  /** A small colored dot before the label, as for a service. */
  readonly dot?: string;
}

export interface DropdownProps<T extends string | number> {
  /** Names the field and its listbox for assistive tech. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly DropdownOption<T>[];
  readonly onChange: (value: T) => void;
  /** The menu is at least as wide as the field; pass this for a wider one. */
  readonly menuWidth?: number;
  readonly style?: StyleProp<ViewStyle>;
}

// TODO(signal-motion): use springs.ts. Snappy is 0.22 s with bounce 0.1.
const SNAPPY = { duration: 220, dampingRatio: 0.9 } as const;

const web = Platform.OS === "web";

// RN's Role union omits "listbox"; react-native-web renders it, VoiceOver on iOS ignores it.
const LISTBOX = { role: "listbox" } as object;

/**
 * A field showing the current value with an up-down chevron. On web it opens an
 * anchored listbox (arrows move, Enter picks, Escape closes, focus returns to the
 * field); on native it opens an action-sheet list. Every non-lens choice uses it.
 */
export function Dropdown<T extends string | number>({ label, value, options, onChange, menuWidth, style }: DropdownProps<T>): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  const type = useTypeRamp();
  const fieldRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [active, setActive] = useState(0);
  const current = options.find((option) => option.value === value);

  const open = (): void => {
    setActive(initialIndex(options.map((option) => option.value), value));
    fieldRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };
  const close = (): void => {
    setAnchor(null);
    if (web) fieldRef.current?.focus();
  };
  const choose = (index: number): void => {
    const option = options[index];
    close();
    if (option && option.value !== value) onChange(option.value);
  };

  // Window capture runs before the app's document-level shortcut dispatcher, which
  // would otherwise take the arrows as "next conversation" and Enter as "focus the composer".
  const openRef = useRef(open);
  openRef.current = open;
  const isOpen = useRef(false);
  isOpen.current = anchor !== null;
  useEffect(() => {
    if (!web) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter" && event.key !== " ") return;
      if (isOpen.current || event.target !== (fieldRef.current as unknown as EventTarget | null)) return;
      event.preventDefault();
      event.stopPropagation();
      openRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
      <Pressable
        ref={fieldRef}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${current?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        onPress={open}
        style={(state: InteractionState) => [
          styles.field,
          { backgroundColor: signal.surface, borderColor: signal.fieldBorder },
          state.hovered && { backgroundColor: theme.backgroundElement },
          (anchor !== null || focusVisible(state)) && ({ outlineColor: signal.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: 1 } as ViewStyle),
          style,
        ]}
      >
        {current?.dot && <View style={[styles.dot, { backgroundColor: current.dot }]} />}
        <Text numberOfLines={1} style={[styles.value, { color: theme.text, fontSize: type.body }]}>
          {current?.label ?? ""}
          {current?.detail && <Text style={{ color: signal.tertiary, fontSize: type.secondary }}>{`  ${current.detail}`}</Text>}
        </Text>
        <Ionicons name="chevron-expand" size={14} color={signal.icon} />
      </Pressable>
      {web ? (
        <WebMenu
          label={label}
          anchor={anchor}
          options={options}
          value={value}
          active={active}
          menuWidth={menuWidth}
          onActive={setActive}
          onChoose={choose}
          onClose={close}
        />
      ) : (
        <NativeSheet label={label} visible={anchor !== null} options={options} value={value} onChoose={choose} onClose={close} />
      )}
    </>
  );
}

interface MenuProps<T extends string | number> {
  readonly label: string;
  readonly anchor: Rect | null;
  readonly options: readonly DropdownOption<T>[];
  readonly value: T;
  readonly active: number;
  readonly menuWidth?: number;
  readonly onActive: (index: number) => void;
  readonly onChoose: (index: number) => void;
  readonly onClose: () => void;
}

function WebMenu<T extends string | number>({ label, anchor, options, value, active, menuWidth, onActive, onChoose, onClose }: MenuProps<T>): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  const type = useTypeRamp();
  const viewport = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const listId = useId();
  const listRef = useRef<View>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const progress = useSharedValue(0);
  const visible = anchor !== null;
  // A menu that opens under a resting pointer must not steal the keyboard highlight.
  const pointerMoved = useRef(false);

  // Window capture runs before the app's document-level shortcut dispatcher, so J, K
  // and the arrows move the menu instead of the conversation list while it is open.
  const keyState = useRef({ active, count: options.length, onActive, onChoose, onClose });
  keyState.current = { active, count: options.length, onActive, onChoose, onClose };
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent): void => {
      const s = keyState.current;
      const result = menuKey(event.key, s.active, s.count);
      event.stopPropagation();
      if (!result) return;
      event.preventDefault();
      if (result.kind === "move") s.onActive(result.index);
      else if (result.kind === "select") s.onChoose(result.index);
      else s.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setSize(null);
      progress.value = 0;
      pointerMoved.current = false;
    }
  }, [visible, progress]);

  const place = anchor && size ? placeMenu(anchor, size, viewport) : null;
  useEffect(() => {
    if (!place) return;
    progress.value = reduceMotion ? 1 : withSpring(1, SNAPPY);
    listRef.current?.focus();
  }, [place !== null, reduceMotion, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.98 + 0.02 * progress.value }],
  }));

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) setSize({ width, height });
  };

  const width = Math.max(anchor?.width ?? 0, menuWidth ?? 0);
  const optionId = (index: number): string => `${listId}-${index}`;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      {anchor && (
        <Animated.View
          onLayout={onLayout}
          style={[
            styles.menu,
            { width, backgroundColor: signal.popBg, boxShadow: signal.popShadow, maxHeight: viewport.height - 16 },
            place ? { left: place.left, top: place.top } : { left: anchor.x, top: anchor.y + anchor.height + 4 },
            animated,
            { transformOrigin: place && place.top < anchor.y ? "bottom right" : "top right" } as ViewStyle,
          ]}
        >
          <ScrollView bounces={false}>
            <View
              ref={listRef}
              aria-label={label}
              tabIndex={-1}
              onPointerMove={() => {
                pointerMoved.current = true;
              }}
              {...({ role: "listbox", "aria-activedescendant": optionId(active) } as object)}
              style={styles.list}
            >
              {options.map((option, index) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={String(option.value)}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    onHoverIn={() => {
                      if (pointerMoved.current) onActive(index);
                    }}
                    onPointerMove={() => {
                      if (index !== active) onActive(index);
                    }}
                    onPress={() => onChoose(index)}
                    style={[styles.option, index === active && { backgroundColor: signal.popSelected }]}
                  >
                    <View style={styles.check}>
                      {selected && <Ionicons name="checkmark" size={15} color={theme.text} />}
                    </View>
                    <View style={styles.optionBody}>
                      <View style={styles.optionTitle}>
                        {option.dot && <View style={[styles.dot, { backgroundColor: option.dot }]} />}
                        <Text style={{ color: theme.text, fontSize: type.body }}>{option.label}</Text>
                        {option.detail && !option.description && (
                          <Text style={{ color: signal.tertiary, fontSize: type.secondary }}>{option.detail}</Text>
                        )}
                      </View>
                      {option.description && (
                        <Text style={[styles.description, { color: signal.tertiary, fontSize: type.secondary }]}>{option.description}</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Animated.View>
      )}
    </Modal>
  );
}

interface SheetProps<T extends string | number> {
  readonly label: string;
  readonly visible: boolean;
  readonly options: readonly DropdownOption<T>[];
  readonly value: T;
  readonly onChoose: (index: number) => void;
  readonly onClose: () => void;
}

function NativeSheet<T extends string | number>({ label, visible, options, value, onChoose, onClose }: SheetProps<T>): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  const type = useTypeRamp();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" style={[StyleSheet.absoluteFill, { backgroundColor: theme.backdrop }]} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View {...LISTBOX} aria-label={label} style={[styles.sheetGroup, { backgroundColor: signal.popBg }]}>
          <Text style={[styles.sheetTitle, { color: signal.tertiary, fontSize: type.secondary }]}>{label}</Text>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={String(option.value)}
                role="option"
                aria-selected={selected}
                onPress={() => onChoose(index)}
                style={({ pressed }) => [
                  styles.sheetOption,
                  { borderTopColor: theme.divider },
                  pressed && { backgroundColor: signal.popSelected },
                ]}
              >
                <View style={styles.optionBody}>
                  <View style={styles.optionTitle}>
                    {option.dot && <View style={[styles.dot, { backgroundColor: option.dot }]} />}
                    <Text style={{ color: theme.text, fontSize: type.title }}>{option.label}</Text>
                    {option.detail && !option.description && <Text style={{ color: signal.tertiary, fontSize: type.body }}>{option.detail}</Text>}
                  </View>
                  {option.description && <Text style={[styles.description, { color: signal.tertiary, fontSize: type.secondary }]}>{option.description}</Text>}
                </View>
                {selected && <Ionicons name="checkmark" size={20} color={theme.accent} />}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.sheetCancel, { backgroundColor: signal.popBg }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ color: theme.accent, fontSize: type.title, fontWeight: "600" }}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 11,
    paddingRight: 7,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  value: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: Radius.full },
  menu: { position: "absolute", borderRadius: Radius.md, overflow: "hidden" },
  // The listbox holds focus for its keys; the highlighted option is the visible focus.
  list: { padding: 5, outlineWidth: 0 },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: Radius.sm,
    cursor: "pointer",
  } as ViewStyle,
  check: { width: 18, paddingTop: 1, alignItems: "center" },
  optionBody: { flex: 1 },
  optionTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  description: { marginTop: 1, lineHeight: 16 },
  sheet: { position: "absolute", left: 8, right: 8, bottom: 0, gap: 8 },
  sheetGroup: { borderRadius: Radius.lg, overflow: "hidden" },
  sheetTitle: { textAlign: "center", paddingVertical: 12 },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetCancel: { borderRadius: Radius.lg, minHeight: 56, alignItems: "center", justifyContent: "center" },
});
