import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { HOVER_DIM, PRESS_DIM } from "@/constants/interaction";
import { Radius, Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { registerFocusTarget, setListMode } from "@/lib/keyboard/controller";

/** `alternate` is Option+Enter, T3's "the other dispatch" while a turn runs. */
export type SendIntent = { readonly text: string; readonly alternate: boolean };

export function AgentInput({ running, onSend, onStop }: {
  readonly running: boolean;
  readonly onSend: (intent: SendIntent) => void;
  readonly onStop: () => void;
}) {
  const theme = useTheme();
  const type = useTypeRamp();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState("");
  const send = (alternate: boolean) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    onSend({ text: trimmed, alternate });
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => registerFocusTarget("agent-input", () => inputRef.current?.focus()), []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (event.isComposing || event.repeat) return;
      sendRef.current(event.altKey);
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <View style={styles.bar}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onFocus={() => setListMode(false)}
          placeholder={running ? "Steer the agent…" : "Ask about this conversation…"}
          placeholderTextColor={theme.textTertiary}
          accessibilityLabel="Ask the agent"
          multiline
          enterKeyHint="send"
          {...(Platform.OS === "web" ? {} : { submitBehavior: "submit" as const, onSubmitEditing: () => sendRef.current(false) })}
          {...({ dataSet: { agentInput: "true" } } as object)}
          style={[
            styles.input,
            Platform.OS === "web" && ({ outlineStyle: "none", resize: "none" } as object),
            { color: theme.text, fontSize: type.body },
          ]}
        />
        <View style={styles.tools}>
          {running ? (
            <RoundButton label="Stop" fill={theme.field} onPress={onStop}>
              <Ionicons name="stop" size={12} color={theme.text} />
            </RoundButton>
          ) : null}
          <RoundButton label="Send" fill={theme.accent} disabled={!text.trim()} onPress={() => send(false)}>
            <Ionicons name="arrow-up" size={17} color={theme.onAccent} />
          </RoundButton>
        </View>
      </View>
    </View>
  );
}

/** The thread composer's round send button, at the 28pt icon-button size. */
function RoundButton({ label, fill, disabled, onPress, children }: {
  readonly label: string;
  readonly fill: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.round,
        { backgroundColor: fill, opacity: disabled ? 0.4 : pressed ? PRESS_DIM : hovered ? HOVER_DIM : 1 },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingBottom: Space.gutter, paddingHorizontal: Space.gutter, paddingTop: Space.xs },
  card: { borderRadius: Radius.lg, borderWidth: 1 },
  input: { maxHeight: 160, minHeight: 44, paddingBottom: Space.xs, paddingHorizontal: Space.lg, paddingTop: Space.lg },
  tools: { flexDirection: "row", gap: Space.sm, justifyContent: "flex-end", paddingBottom: Space.md, paddingHorizontal: Space.md },
  round: { alignItems: "center", borderRadius: Radius.full, height: 28, justifyContent: "center", width: 28 },
  pressed: { transform: [{ scale: 0.96 }] },
});
