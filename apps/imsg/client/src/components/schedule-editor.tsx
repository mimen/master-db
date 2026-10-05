import { useEffect, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { parseScheduleInput, scheduleInputParts } from "@/lib/scheduled";
import { HOVER_DIM, PRESS_DIM } from "@/constants/theme";
import { OverlayShell } from "./overlay-shell";
import { useTheme } from "@/hooks/use-theme";

interface ScheduleEditorProps {
  visible: boolean;
  title: string;
  initialText: string;
  initialSendAt: number;
  textEditable?: boolean;
  /** Pin the card's bottom-right corner this far from the window's bottom-right (desktop send button). */
  anchor?: { right: number; bottom: number } | null;
  onClose: () => void;
  onSubmit: (text: string, sendAt: number) => Promise<void>;
}

export function ScheduleEditor({
  visible,
  title,
  initialText,
  initialSendAt,
  textEditable = true,
  anchor = null,
  onClose,
  onSubmit,
}: ScheduleEditorProps): ReactElement {
  const theme = useTheme();
  const initial = scheduleInputParts(initialSendAt);
  const [text, setText] = useState(initialText);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const parts = scheduleInputParts(initialSendAt);
    setText(initialText);
    setDate(parts.date);
    setTime(parts.time);
    setError(null);
  }, [initialSendAt, initialText, visible]);

  const submit = async (): Promise<void> => {
    if (!text.trim()) {
      setError("Message text is required");
      return;
    }
    const parsed = parseScheduleInput(date.trim(), time.trim());
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), parsed.value);
      onClose();
    } catch {
      setError("Couldn't save this scheduled message");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayShell
      visible={visible}
      onClose={onClose}
      cardStyle={[styles.card, anchor && styles.anchoredCard]}
      backdropStyle={[
        styles.backdrop,
        anchor && { alignItems: "flex-end", justifyContent: "flex-end", paddingRight: anchor.right, paddingBottom: anchor.bottom },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {textEditable && (
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Message"
          placeholderTextColor={theme.textTertiary}
          style={[
            styles.message,
            { color: theme.text, backgroundColor: theme.field, borderColor: theme.dividerStrong },
          ]}
        />
      )}
      <View style={styles.fields}>
        <View style={styles.fieldWrap}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            autoCapitalize="none"
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textTertiary}
            style={[
              styles.field,
              { color: theme.text, backgroundColor: theme.field, borderColor: theme.dividerStrong },
            ]}
          />
        </View>
        <View style={styles.fieldWrap}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Time</Text>
          <TextInput
            value={time}
            onChangeText={setTime}
            autoCapitalize="none"
            placeholder="HH:MM"
            placeholderTextColor={theme.textTertiary}
            style={[
              styles.field,
              { color: theme.text, backgroundColor: theme.field, borderColor: theme.dividerStrong },
            ]}
          />
        </View>
      </View>
      {error && <Text style={{ color: theme.destructive, fontSize: 13 }}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onClose}
          disabled={busy}
          style={({ hovered, pressed }) => [styles.button, { borderColor: theme.dividerStrong, borderWidth: 1 }, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
        >
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save schedule"
          onPress={() => void submit()}
          disabled={busy}
          style={({ hovered, pressed }) => [styles.button, styles.primary, { backgroundColor: theme.text }, !busy && hovered && !pressed && { opacity: HOVER_DIM }, !busy && pressed && { opacity: PRESS_DIM }, busy && { opacity: 0.55 }]}
        >
          <Text style={{ color: theme.background, fontSize: 13, fontWeight: "600" }}>
            {busy ? "Saving…" : "Save"}
          </Text>
        </Pressable>
      </View>
    </OverlayShell>
  );
}

const styles = StyleSheet.create({
  backdrop: { padding: 18 },
  card: {
    borderRadius: 16,
    gap: 14,
    maxWidth: 460,
    padding: 18,
    width: "100%",
  },
  anchoredCard: { width: 380 },
  title: { fontSize: 15, fontWeight: "600" },
  message: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    minHeight: 88,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  fields: { flexDirection: "row", gap: 10 },
  fieldWrap: { flex: 1, gap: 5 },
  label: { fontSize: 12, fontWeight: "600" },
  field: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  button: { alignItems: "center", borderRadius: 8, height: 30, justifyContent: "center", paddingHorizontal: 12 },
  primary: { minWidth: 82, alignItems: "center" },
});
