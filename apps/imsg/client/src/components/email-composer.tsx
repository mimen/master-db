import type { ConversationId } from "@shared/types";
import { ConvexError } from "convex/values";
import { useState, type JSX } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";

import { ScheduleEditor } from "@/components/schedule-editor";
import { useTheme } from "@/hooks/use-theme";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { commaDraftsApi, scheduledSendsApi } from "@/lib/convex-api";
import { runCommand } from "@/lib/convex-commands";
import { hasRecipient, replyFields, type EmailFields, type ReplyMode, type ReplySource } from "@/lib/mail";
import { messagingCommandError } from "@/lib/messaging-api";
import { scheduleOptions } from "@/lib/scheduled";
import { showToast } from "@/lib/toast";

/**
 * The email composer: To, Cc, subject and body for a reply in the open thread. Enter adds a line and ⌘Enter sends. A
 * send goes through the pending-send lifecycle like any other, so its card shows at once and becomes Gmail's message.
 * Send later schedules it in Convex, which sends it at the time with no client open.
 */

export interface ComposerStart {
  mode: ReplyMode;
  /** The message the reply answers. */
  replyTo: ReplySource & { guid: string };
  text?: string;
  /** The agent's note beside its draft, never sent. */
  note?: string;
}

export function EmailComposer({ conversationId, start, subject, self, hasDraft, onClose }: {
  conversationId: ConversationId;
  start: ComposerStart;
  subject: string;
  self: ReadonlySet<string>;
  hasDraft: boolean;
  onClose: () => void;
}): JSX.Element {
  const theme = useTheme();
  const [mode, setMode] = useState(start.mode);
  const [fields, setFields] = useState<EmailFields>(() => replyFields(start.replyTo, start.mode, subject, self));
  const [text, setText] = useState(start.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const showSheet = useActionSheet();
  const ready = !sending && text.trim().length > 0 && hasRecipient(fields);
  const list = (field: string) => (field.trim() ? [field.trim()] : []);
  const payload = (body: string) => ({
    kind: "send" as const, text: body, replyToGuid: start.replyTo.guid,
    email: { to: list(fields.to), cc: list(fields.cc), subject: fields.subject.trim() },
  });
  const clearDraft = () => import("@/lib/identity").then(({ convexClient }) => convexClient.mutation(commaDraftsApi.clearDraft, { conversationId }));

  const switchMode = (next: ReplyMode) => {
    setMode(next);
    setFields((current) => ({ ...replyFields(start.replyTo, next, subject, self), subject: current.subject }));
  };

  const discard = () => {
    if (hasDraft) void clearDraft().catch(() => showToast("Couldn't discard the draft."));
    onClose();
  };

  const send = () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    runCommand(conversationId, payload(text), { onQueued: onClose }).catch((failure: unknown) => {
      // Refused at enqueue, the composer is still open and says why. After it closes, the card shows the outcome.
      setSending(false);
      setError(failure instanceof ConvexError ? String(failure.data) : messagingCommandError(failure, "Couldn't send the email."));
    });
  };

  const schedule = async (body: string, sendAt: number): Promise<void> => {
    const { convexClient } = await import("@/lib/identity");
    await convexClient.mutation(scheduledSendsApi.schedule, { conversationId, payload: payload(body), sendAt });
    if (hasDraft) void clearDraft().catch(() => undefined);
    showToast("Email scheduled");
    onClose();
  };

  const openLater = (event: GestureResponderEvent) => {
    if (!ready) return;
    const later = (sendAt: number) => {
      setSending(true);
      setError(null);
      schedule(text, sendAt).catch((failure: unknown) => {
        setSending(false);
        setError(failure instanceof ConvexError ? String(failure.data) : "Couldn't schedule the email.");
      });
    };
    showSheet({
      title: "Send later",
      anchor: pressAnchor(event),
      actions: [
        ...scheduleOptions().map((option) => ({ label: option.label, onPress: () => later(option.at) })),
        { label: "Choose Date & Time…", onPress: () => setPicking(true) },
      ],
    });
  };

  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent as TextInputKeyPressEventData & { metaKey?: boolean; ctrlKey?: boolean };
    if (key.key !== "Enter" || !(key.metaKey || key.ctrlKey)) return;
    event.preventDefault();
    send();
  };

  const field = (label: string, value: string, onChange: (value: string) => void) => (
    <View style={[styles.field, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        onKeyPress={onKeyPress}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: theme.text }, Platform.OS === "web" && styles.webInput]}
      />
    </View>
  );

  return (
    <View testID="email-composer" style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.divider }]}>
      <View style={styles.top}>
        <View role="tablist" style={styles.modes}>
          {(["reply", "replyAll"] as const).map((option) => (
            <Pressable
              key={option}
              role="tab"
              aria-selected={mode === option}
              onPress={() => switchMode(option)}
              style={[styles.mode, mode === option && { backgroundColor: theme.rowSelected }]}
            >
              <Text style={[styles.modeText, { color: mode === option ? theme.text : theme.textSecondary }]}>{option === "reply" ? "Reply" : "Reply all"}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={discard} hitSlop={8}>
          <Text style={[styles.discard, { color: theme.textSecondary }]}>Discard</Text>
        </Pressable>
      </View>
      {field("To", fields.to, (to) => setFields((current) => ({ ...current, to })))}
      {field("Cc", fields.cc, (cc) => setFields((current) => ({ ...current, cc })))}
      {field("Subject", fields.subject, (value) => setFields((current) => ({ ...current, subject: value })))}
      {start.note ? <Text style={[styles.note, { color: theme.textSecondary }]}>{start.note}</Text> : null}
      <TextInput
        accessibilityLabel="Message"
        placeholder="Write a reply"
        placeholderTextColor={theme.textTertiary}
        value={text}
        onChangeText={setText}
        onKeyPress={onKeyPress}
        multiline
        autoFocus
        style={[styles.body, { color: theme.text }, Platform.OS === "web" && styles.webInput]}
      />
      <View style={styles.bottom}>
        <Text style={[styles.hint, { color: error ? theme.destructive : theme.textTertiary }]} numberOfLines={2}>
          {error ?? (Platform.OS === "web" ? "⌘↩ to send" : "")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send later"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={openLater}
          style={[styles.later, { borderColor: theme.divider, opacity: ready ? 1 : 0.45 }]}
        >
          <Text style={[styles.laterText, { color: theme.text }]}>Send later</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!ready}
          onPress={send}
          style={[styles.send, { backgroundColor: theme.accent, opacity: ready ? 1 : 0.45 }]}
        >
          <Text style={styles.sendText}>{sending ? "Sending…" : "Send"}</Text>
        </Pressable>
      </View>
      <ScheduleEditor
        visible={picking}
        title="Send Email Later"
        initialText={text}
        initialSendAt={Date.now() + 3_600_000}
        textEditable={false}
        onClose={() => setPicking(false)}
        onSubmit={(body, sendAt) => schedule(body, sendAt)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2, marginHorizontal: 20, marginVertical: 12, padding: 12 },
  top: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingBottom: 6 },
  modes: { flexDirection: "row", gap: 4 },
  mode: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 4 },
  modeText: { fontSize: 13, fontWeight: "600" },
  discard: { fontSize: 13 },
  field: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, paddingVertical: 6 },
  label: { fontSize: 13, width: 56 },
  input: { flex: 1, fontSize: 14, paddingVertical: 2 },
  webInput: { outlineStyle: "none" } as object,
  note: { fontSize: 12.5, fontStyle: "italic", paddingTop: 8 },
  body: { fontSize: 14, lineHeight: 21, minHeight: 120, paddingTop: 10, textAlignVertical: "top" },
  bottom: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between", paddingTop: 6 },
  hint: { flex: 1, fontSize: 12 },
  later: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 7 },
  laterText: { fontSize: 14, fontWeight: "600" },
  send: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
