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
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { CardShadow, Radii, Type } from "@/constants/theme";
import { presentActions, type IconName } from "@/lib/action-presentation";
import { useTheme } from "@/hooks/use-theme";
import type { ThemeColors } from "@/components/ui/interaction";
import { TapbackTray, type TrayTapback } from "@/components/tapback-tray";

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

function actionColor(c: ThemeColors, action: SheetAction): string {
  return action.disabled ? c.disabled : action.destructive ? c.destructive : c.text;
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
  /** The tapback tray, floated above the actions. */
  tapbacks?: TrayTapback[];
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
  const theme = useTheme();
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
            {rendered?.tapbacks && (
              <TapbackTray tapbacks={rendered.tapbacks} onDone={() => setRequest(null)} />
            )}
            <Pressable
              style={[styles.dialog, { backgroundColor: theme.popBg, borderColor: theme.divider, boxShadow: theme.popShadow }]}
              onPress={() => undefined}
            >
              {rendered?.title && (
                <Text style={[styles.dialogTitle, { color: theme.textSecondary }]}>{rendered.title}</Text>
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
              <View style={styles.sheetTray}>
                <TapbackTray tapbacks={rendered.tapbacks} size="touch" onDone={() => setRequest(null)} />
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
// Six 36pt buttons, 2pt gaps, 4pt padding.
const TRAY_W = 6 * 36 + 5 * 2 + 8;

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
  const c = useTheme();
  const { anchor, tapbacks, actions } = request;
  const width = tapbacks ? Math.max(POP_W, TRAY_W) : POP_W;
  const requestedLeft = anchor.align === "end" ? anchor.x - POP_W + 18 : anchor.x;
  const left = Math.max(8, Math.min(requestedLeft, winW - width - 8));
  // Anchors near the bottom (composer attach) open upward.
  const openUp = anchor.y > winH - 340;
  const place = openUp ? { bottom: winH - anchor.y + 6 } : { top: Math.min(anchor.y + 10, winH - 80) };
  const presented = presentActions(actions);
  return (
    <View style={[styles.popoverStack, { left }, place]}>
      {tapbacks && <TapbackTray tapbacks={tapbacks} onDone={onDone} />}
      {actions.length > 0 && (
        <View role="menu" style={[styles.menuCard, { backgroundColor: c.popBg, boxShadow: c.popShadow }]}>
          {actions.map((action, i) => {
            const p = presented[i]!;
            const color = actionColor(c, action);
            const iconColor = action.disabled ? c.disabled : action.destructive ? c.destructive : c.icon;
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
  backdrop: {
    flex: 1,
    // Lighter scrim than the shared 0.45 backdrop token — intentional, not swept.
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  dialogBackdrop: {
    alignItems: "center",
    flex: 1,
    gap: TAPBACK_GAP,
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
  sheetTray: {
    alignItems: "center",
    marginBottom: 4,
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
});
