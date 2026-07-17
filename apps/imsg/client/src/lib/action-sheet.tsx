import { createContext, useCallback, useContext, useState } from "react";
import {
  ActionSheetIOS,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
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
        animationType="fade"
        onRequestClose={() => setRequest(null)}
      >
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
      </Modal>
    </SheetContext.Provider>
  );
}

const styles = StyleSheet.create({
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
