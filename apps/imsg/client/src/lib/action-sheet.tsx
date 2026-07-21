import { createContext, useCallback, useContext, useState } from "react";
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
  const theme = useTheme();
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
        animationType={request?.anchor ? "none" : "fade"}
        onRequestClose={() => setRequest(null)}
      >
        {request?.anchor ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRequest(null)}>
            {(() => {
              const POP_W = 232;
              const left = Math.max(8, Math.min(request.anchor.x, winW - POP_W - 8));
              const top = Math.min(request.anchor.y, winH - 80);
              return (
                <View
                  style={[
                    styles.popover,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.divider, top, left, width: POP_W },
                  ]}
                >
                  {request.tapbacks && (
                    <View style={styles.tapbackRow}>
                      {request.tapbacks.map((t) => (
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
                  {request.actions.map((action) => (
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
          <View style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}>
            {request?.tapbacks && (
              <View style={styles.tapbackRow}>
                {request.tapbacks.map((t) => (
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
            {request?.title && (
              <Text style={[styles.title, { color: theme.textSecondary }]}>{request.title}</Text>
            )}
            {request?.actions.map((action) => (
              <Pressable
                key={action.label}
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
            ))}
          </View>
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
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    padding: 12,
  },
  sheet: {
    borderRadius: 16,
    paddingVertical: 6,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 8,
  },
  action: {
    paddingVertical: 13,
    paddingHorizontal: 20,
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
  actionLabel: {
    fontSize: 17,
    textAlign: "center",
  },
});
