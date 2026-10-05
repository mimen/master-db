import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { CardShadow, Radii, Type } from "@/constants/theme";
import { presentActions, type IconName } from "@/lib/action-presentation";

export interface SheetAction {
  label: string;
  destructive?: boolean;
  /** Shown but inert, so the user learns the action exists and why it is unavailable. */
  disabled?: boolean;
  /** Desktop menu only. Left out, it is derived from the label (lib/action-presentation.ts). */
  icon?: IconName;
  /** Display-only key hint on the desktop menu. */
  shortcut?: string;
  /** Secondary line under the item, e.g. why it is disabled. */
  note?: string;
  separatorBefore?: boolean;
  onPress: () => void;
}

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = {
  light: {
    popBg: "#FFFFFF",
    popShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 18px 48px -12px rgba(0,0,0,0.28)",
    popSelected: "rgba(0,0,0,0.075)",
    popTertiary: "#64646B",
    text: "#17171A",
    textSecondary: "#55555C",
    icon: "#5E5E66",
    disabled: "#A2A2A8",
    danger: "#C4261B",
    divider: "rgba(0,0,0,0.075)",
    bubbleMine: "#007AFF",
    onBubbleMine: "#FFFFFF",
    scrim: "rgba(23,23,26,0.16)",
    focusRing: "#E0500F",
  },
  dark: {
    popBg: "#232326",
    popShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 18px 48px -12px rgba(0,0,0,0.8)",
    popSelected: "rgba(255,255,255,0.06)",
    popTertiary: "#A0A0A7",
    text: "#EDEDEF",
    textSecondary: "#A6A6AD",
    icon: "#97979E",
    disabled: "#5E5E64",
    danger: "#FF6B5E",
    divider: "rgba(255,255,255,0.07)",
    bubbleMine: "#0A84FF",
    onBubbleMine: "#FFFFFF",
    scrim: "rgba(0,0,0,0.5)",
    focusRing: "#FF7A40",
  },
} as const;
type SignalColors = (typeof SIGNAL)[keyof typeof SIGNAL];

function useSignal(): SignalColors {
  return SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
}

function actionColor(c: SignalColors, action: SheetAction): string {
  return action.disabled ? c.disabled : action.destructive ? c.danger : c.text;
}

export interface SheetTapback {
  emoji: string;
  /** Spoken name, e.g. "Love"; the emoji alone reads poorly to a screen reader. */
  label: string;
  active: boolean;
  onPress: () => void;
}

export interface PopoverAnchor {
  x: number;
  y: number;
  /** Align the popover's trailing edge to the invoking control. */
  align?: "start" | "end";
}

interface SheetRequest {
  title?: string;
  actions: SheetAction[];
  /** Optional horizontal reaction pill rendered above the actions. */
  tapbacks?: SheetTapback[];
  /** Desktop right-click: viewport coords to anchor a compact popover at. */
  anchor?: PopoverAnchor;
}

type ShowSheet = (request: SheetRequest) => void;

const SheetContext = createContext<ShowSheet>(() => undefined);

export function useActionSheet(): ShowSheet {
  return useContext(SheetContext);
}

/** Viewport point of a press, for desktop popovers that should sit on the button. */
export function pressAnchor(event: GestureResponderEvent): PopoverAnchor {
  return { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
}

/**
 * Cross-platform action sheet: native ActionSheetIOS on iOS, a bottom-sheet
 * modal on web/Android.
 */
export function ActionSheetProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<SheetRequest | null>(null);
  // Retain the last request through the close animation: if the branch flipped
  // to the bottom-sheet the instant request went null, its dark backdrop would
  // slide out over anchored context menus (the gray sweep-down bug).
  const lastRequestRef = useRef<SheetRequest | null>(null);
  if (request !== null) lastRequestRef.current = request;
  const rendered = request ?? lastRequestRef.current;
  const theme = useSignal();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { wide } = useLayoutMode();
  // Desktop NEVER gets a bottom sheet: anchored requests are cursor popovers,
  // everything else is a centered dialog. The dark backdrop is mobile-sheet-only.
  const desktop = Platform.OS === "web" && wide;
  const variant: "popover" | "dialog" | "sheet" = rendered?.anchor
    ? "popover"
    : desktop
      ? "dialog"
      : "sheet";

  const show = useCallback((req: SheetRequest) => {
    // The tapback pill needs the custom sheet on every platform.
    if (Platform.OS === "ios" && !req.tapbacks) {
      const enabled = req.actions.filter((a) => !a.disabled);
      const labels = [...enabled.map((a) => a.label), "Cancel"];
      const destructiveIndexes = enabled
        .map((a, i) => (a.destructive ? i : -1))
        .filter((i) => i >= 0);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: req.title,
          options: labels,
          cancelButtonIndex: labels.length - 1,
          destructiveButtonIndex: destructiveIndexes.length === 1 ? destructiveIndexes[0] : undefined,
        },
        (index) => {
          enabled[index]?.onPress();
        },
      );
      return;
    }
    setRequest(req);
  }, []);

  return (
    <SheetContext.Provider value={show}>
      {children}
      <Modal
        visible={request !== null}
        transparent
        animationType={variant === "sheet" ? "slide" : "none"}
        onRequestClose={() => setRequest(null)}
      >
        {variant === "popover" && rendered?.anchor ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRequest(null)}>
            <PopoverMenu
              request={{ ...rendered, anchor: rendered.anchor }}
              winW={winW}
              winH={winH}
              onDone={() => setRequest(null)}
            />
          </Pressable>
        ) : variant === "dialog" ? (
          <Pressable style={styles.dialogBackdrop} onPress={() => setRequest(null)}>
            <Pressable
              style={[styles.dialog, { backgroundColor: theme.popBg, borderColor: theme.divider, boxShadow: theme.popShadow }]}
              onPress={() => undefined}
            >
              {rendered?.title && (
                <Text style={[styles.dialogTitle, { color: theme.textSecondary }]}>{rendered.title}</Text>
              )}
              {rendered?.tapbacks && (
                <View style={styles.tapbackRow}>
                  {rendered.tapbacks.map((t) => (
                    <Pressable
                      key={t.emoji}
                      accessibilityRole="button"
                      accessibilityLabel={t.active ? `Remove ${t.label}` : t.label}
                      aria-selected={t.active}
                      onPress={() => {
                        setRequest(null);
                        t.onPress();
                      }}
                      style={[styles.tapback, styles.tapbackSmall, t.active && { backgroundColor: theme.bubbleMine }]}
                    >
                      <Text style={{ fontSize: 20 }}>{t.emoji}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {rendered?.actions.map((action) => (
                <Pressable
                  key={action.label}
                  style={({ pressed }) => [
                    styles.dialogAction,
                    pressed && { backgroundColor: theme.popSelected },
                  ]}
                  disabled={action.disabled}
                  accessibilityState={{ disabled: !!action.disabled }}
                  onPress={() => {
                    setRequest(null);
                    action.onPress();
                  }}
                >
                  <Text style={[styles.dialogLabel, { color: actionColor(theme, action) }]}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        ) : (
        <Pressable style={styles.backdrop} onPress={() => setRequest(null)}>
          <Pressable
            style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}
            onPress={() => undefined}
          >
            {rendered?.tapbacks && (
              <View style={[styles.tapbackPill, { backgroundColor: theme.popBg }]}>
                {rendered.tapbacks.map((t) => (
                  <Pressable
                    key={t.emoji}
                    onPress={() => {
                      setRequest(null);
                      t.onPress();
                    }}
                    style={[styles.tapback, t.active && { backgroundColor: theme.bubbleMine }]}
                  >
                    <Text style={{ fontSize: 24 }}>{t.emoji}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={[styles.sheetGroup, { backgroundColor: theme.popBg }]}>
              {rendered?.title && (
                <View style={styles.sheetTitleWrap}>
                  <Text style={[styles.title, { color: theme.textSecondary }]}>{rendered?.title}</Text>
                </View>
              )}
              {rendered?.actions.map((action, i) => (
                <View key={action.label}>
                  {(i > 0 || rendered?.title) && (
                    <View style={[styles.rowDivider, { backgroundColor: theme.divider }]} />
                  )}
                  <Pressable
                    style={({ pressed }) => [
                      styles.action,
                      pressed && { backgroundColor: theme.popSelected },
                    ]}
                    disabled={action.disabled}
                    accessibilityState={{ disabled: !!action.disabled }}
                    onPress={() => {
                      setRequest(null);
                      action.onPress();
                    }}
                  >
                    <Text
                      style={[styles.actionLabel, { color: actionColor(theme, action) }]}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                { backgroundColor: theme.popBg },
                pressed && { backgroundColor: theme.popSelected },
              ]}
              onPress={() => setRequest(null)}
            >
              <Text style={[styles.cancelLabel, { color: theme.bubbleMine }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
        )}
      </Modal>
    </SheetContext.Provider>
  );
}

const POP_W = 240;
const TAPBACK_GAP = 8;

// Glyphs drawn to match the mockup; anything unknown falls back to its emoji.
const TAPBACK_GLYPHS: Record<string, { icon: IconName } | { text: string; size: number }> = {
  Love: { icon: "heart" },
  Like: { icon: "thumbs-up-outline" },
  Dislike: { icon: "thumbs-down-outline" },
  Laugh: { text: "HA\nHA", size: 9 },
  Emphasize: { text: "!!", size: 16 },
  Question: { text: "?", size: 18 },
};

function TapbackGlyph({ tapback, color }: { tapback: SheetTapback; color: string }) {
  const glyph = TAPBACK_GLYPHS[tapback.label];
  if (!glyph) return <Text style={{ fontSize: 20 }}>{tapback.emoji}</Text>;
  if ("icon" in glyph) {
    const heart = glyph.icon === "heart" && !tapback.active;
    return <Ionicons name={glyph.icon} size={19} color={heart ? "#FF375F" : color} />;
  }
  return (
    <Text style={[styles.tapbackText, { color, fontSize: glyph.size, lineHeight: glyph.size + (glyph.size < 12 ? 0 : 2) }]}>
      {glyph.text}
    </Text>
  );
}

/** Desktop right-click menu: a tapback pill floating above a separate menu card. */
function PopoverMenu({
  request,
  winW,
  winH,
  onDone,
}: {
  request: SheetRequest & { anchor: PopoverAnchor };
  winW: number;
  winH: number;
  onDone: () => void;
}) {
  const c = useSignal();
  const { anchor, tapbacks, actions } = request;
  const width = tapbacks ? Math.max(POP_W, tapbacks.length * 40 + 6) : POP_W;
  const requestedLeft = anchor.align === "end" ? anchor.x - POP_W + 18 : anchor.x;
  const left = Math.max(8, Math.min(requestedLeft, winW - width - 8));
  // Anchors near the bottom (composer attach) open upward.
  const openUp = anchor.y > winH - 340;
  const place = openUp ? { bottom: winH - anchor.y + 6 } : { top: Math.min(anchor.y + 10, winH - 80) };
  const presented = presentActions(actions);
  return (
    <View style={[styles.popoverStack, { left }, place]}>
      {tapbacks && (
        <View style={[styles.tapbackBar, { backgroundColor: c.popBg, boxShadow: c.popShadow }]}>
          {tapbacks.map((t) => (
            <Pressable
              key={t.emoji}
              accessibilityRole="button"
              accessibilityLabel={t.active ? `Remove ${t.label}` : t.label}
              aria-selected={t.active}
              onPress={() => {
                onDone();
                t.onPress();
              }}
              style={({ hovered, pressed }) => [
                styles.tapback36,
                (hovered || pressed) && { backgroundColor: c.popSelected },
                t.active && { backgroundColor: c.bubbleMine },
              ]}
            >
              <TapbackGlyph tapback={t} color={t.active ? c.onBubbleMine : c.textSecondary} />
            </Pressable>
          ))}
        </View>
      )}
      {actions.length > 0 && (
        <View role="menu" style={[styles.menuCard, { backgroundColor: c.popBg, boxShadow: c.popShadow }]}>
          {actions.map((action, i) => {
            const p = presented[i]!;
            const color = actionColor(c, action);
            const iconColor = action.disabled ? c.disabled : action.destructive ? c.danger : c.icon;
            return (
              <View key={action.label}>
                {p.separatorBefore && <View style={[styles.menuSeparator, { backgroundColor: c.divider }]} />}
                <Pressable
                  role="menuitem"
                  accessibilityLabel={p.label}
                  accessibilityHint={p.note}
                  disabled={action.disabled}
                  accessibilityState={{ disabled: !!action.disabled }}
                  onPress={() => {
                    onDone();
                    action.onPress();
                  }}
                  style={({ hovered, pressed }) => [
                    styles.menuRow,
                    !action.disabled && (hovered || pressed) && { backgroundColor: c.popSelected },
                  ]}
                >
                  {p.icon ? <Ionicons aria-hidden name={p.icon} size={15} color={iconColor} /> : <View style={styles.menuIconGap} />}
                  <Text numberOfLines={1} style={[styles.menuLabel, { color }]}>{p.label}</Text>
                  {p.shortcut && (
                    <Text aria-hidden style={[styles.menuShortcut, { color: action.disabled ? c.disabled : c.popTertiary }]}>
                      {p.shortcut}
                    </Text>
                  )}
                </Pressable>
                {p.note && <Text style={[styles.menuNote, { color: c.popTertiary }]}>{p.note}</Text>}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  popoverStack: {
    alignItems: "flex-start",
    gap: TAPBACK_GAP,
    position: "absolute",
  },
  tapbackBar: {
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    padding: 5,
  },
  tapback36: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  tapbackText: {
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  menuCard: {
    borderRadius: 12,
    padding: 6,
    width: POP_W,
  },
  menuRow: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    height: 32,
    paddingHorizontal: 9,
  },
  menuIconGap: {
    width: 15,
  },
  menuLabel: {
    flex: 1,
    fontSize: 13,
  },
  menuShortcut: {
    fontSize: 11.5,
  },
  menuNote: {
    fontSize: 11.5,
    paddingBottom: 6,
    paddingLeft: 34,
    paddingRight: 9,
    paddingTop: 2,
  },
  menuSeparator: {
    height: 1,
    marginHorizontal: 6,
    marginVertical: 4,
  },
  tapbackSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  backdrop: {
    flex: 1,
    // Lighter scrim than the shared 0.45 backdrop token — intentional, not swept.
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  dialogBackdrop: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  dialog: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "86%",
    paddingVertical: 6,
    ...CardShadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
    width: 300,
  },
  dialogTitle: {
    fontSize: Type.secondary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    textAlign: "center",
  },
  dialogAction: {
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16,
  },
  dialogLabel: {
    fontSize: 15,
  },
  sheetWrap: {
    alignSelf: "center",
    gap: 8,
    maxWidth: 500,
    paddingHorizontal: 8,
    width: "100%",
  },
  sheetGroup: {
    borderRadius: Radii.card,
    overflow: "hidden",
  },
  sheetTitleWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: Type.secondary,
    textAlign: "center",
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  actionLabel: {
    fontSize: 20,
    textAlign: "center",
  },
  cancelButton: {
    alignItems: "center",
    borderRadius: Radii.card,
    justifyContent: "center",
    minHeight: 56,
  },
  cancelLabel: {
    fontSize: 20,
    fontWeight: "600",
  },
  tapbackPill: {
    alignSelf: "center",
    borderRadius: 28,
    flexDirection: "row",
    gap: 4,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    ...CardShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  tapbackRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tapback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
