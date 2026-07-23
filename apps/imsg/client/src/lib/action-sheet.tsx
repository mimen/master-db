import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";

export interface SheetAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export interface SheetTapback {
  emoji: string;
  active: boolean;
  onPress: () => void;
}

interface SheetRequest {
  title?: string;
  actions: SheetAction[];
  /** Optional horizontal reaction pill rendered above the actions. */
  tapbacks?: SheetTapback[];
  /** Desktop right-click: viewport coords to anchor a compact popover at. */
  anchor?: { x: number; y: number };
}

type ShowSheet = (request: SheetRequest) => void;

const SheetContext = createContext<ShowSheet>(() => undefined);

export function useActionSheet(): ShowSheet {
  return useContext(SheetContext);
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

  const show = useCallback((req: SheetRequest) => {
    // The tapback pill needs the custom sheet on every platform.
    if (Platform.OS === "ios" && !req.tapbacks) {
      const labels = [...req.actions.map((a) => a.label), "Cancel"];
      const destructiveIndexes = req.actions
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
          req.actions[index]?.onPress();
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
        animationType={rendered?.anchor ? "none" : "slide"}
        onRequestClose={() => setRequest(null)}
      >
        {rendered?.anchor ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRequest(null)}>
            {(() => {
              const POP_W = 232;
              const left = Math.max(8, Math.min(rendered.anchor.x, winW - POP_W - 8));
              const top = Math.min(rendered.anchor.y, winH - 80);
              return (
                <View
                  style={[
                    styles.popover,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.divider, top, left, width: POP_W },
                  ]}
                >
                  {rendered.tapbacks && (
                    <View style={styles.tapbackRow}>
                      {rendered.tapbacks.map((t) => (
                        <Pressable
                          key={t.emoji}
                          onPress={() => {
                            setRequest(null);
                            t.onPress();
                          }}
                          style={[styles.tapback, styles.tapbackSmall, t.active && styles.tapbackActive]}
                        >
                          <Text style={{ fontSize: 20 }}>{t.emoji}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {rendered.actions.map((action) => (
                    <Pressable
                      key={action.label}
                      style={({ pressed }) => [
                        styles.popoverAction,
                        pressed && { backgroundColor: theme.backgroundSelected },
                      ]}
                      onPress={() => {
                        setRequest(null);
                        action.onPress();
                      }}
                    >
                      <Text
                        style={[styles.popoverLabel, { color: action.destructive ? "#FF453A" : theme.text }]}
                      >
                        {action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })()}
          </Pressable>
        ) : (
        <Pressable style={styles.backdrop} onPress={() => setRequest(null)}>
          <Pressable
            style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}
            onPress={() => undefined}
          >
            {rendered?.tapbacks && (
              <View style={[styles.tapbackPill, { backgroundColor: theme.backgroundElement }]}>
                {rendered.tapbacks.map((t) => (
                  <Pressable
                    key={t.emoji}
                    onPress={() => {
                      setRequest(null);
                      t.onPress();
                    }}
                    style={[styles.tapback, t.active && styles.tapbackActive]}
                  >
                    <Text style={{ fontSize: 24 }}>{t.emoji}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={[styles.sheetGroup, { backgroundColor: theme.backgroundElement }]}>
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
                      pressed && { backgroundColor: theme.backgroundSelected },
                    ]}
                    onPress={() => {
                      setRequest(null);
                      action.onPress();
                    }}
                  >
                    <Text
                      style={[styles.actionLabel, { color: action.destructive ? "#FF453A" : theme.text }]}
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
                { backgroundColor: theme.backgroundElement },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
              onPress={() => setRequest(null)}
            >
              <Text style={[styles.cancelLabel, { color: theme.accent }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
        )}
      </Modal>
    </SheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  popover: {
    position: "absolute",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  popoverAction: {
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  popoverLabel: {
    fontSize: 14,
  },
  tapbackSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheetWrap: {
    alignSelf: "center",
    gap: 8,
    maxWidth: 500,
    paddingHorizontal: 8,
    width: "100%",
  },
  sheetGroup: {
    borderRadius: 14,
    overflow: "hidden",
  },
  sheetTitleWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 13,
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
    borderRadius: 14,
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
    shadowColor: "#000",
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
  tapbackActive: {
    backgroundColor: "#0A84FF",
  },
});
