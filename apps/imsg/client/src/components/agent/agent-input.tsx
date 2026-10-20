import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
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
    <View style={[styles.bar, { borderTopColor: theme.divider }]}>
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
          { backgroundColor: theme.surface, borderColor: theme.dividerStrong, color: theme.text, fontSize: type.body },
        ]}
      />
      <View style={styles.actions}>
        {running ? <Button label="Stop" variant="ghost" onPress={onStop} /> : null}
        <Button label="Send" variant="primary" disabled={!text.trim()} onPress={() => send(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, gap: Space.md, padding: Space.lg },
  input: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, maxHeight: 160, minHeight: 64, paddingHorizontal: Space.lg, paddingVertical: Space.md },
  actions: { flexDirection: "row", gap: Space.md, justifyContent: "flex-end" },
});
