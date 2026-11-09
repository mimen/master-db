import { forwardSubject, forwardText, mailboxText, parseTyped, replyRecipients, replySubject, type MailAddress, type ReplyMode, type ReplySource } from "@shared/email-reply";
import type { ConversationId } from "@shared/types";
import type { GenericId } from "convex/values";
import { useState, type JSX } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";

import { formatFileSize } from "@/components/message-meta";
import { ScheduleEditor } from "@/components/schedule-editor";
import { useTheme } from "@/hooks/use-theme";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { commaDraftsApi, scheduledSendsApi } from "@/lib/convex-api";
import { runCommand } from "@/lib/convex-commands";
import { formatReceiptTime } from "@/lib/format";
import type { MailFile } from "@/lib/mail";
import { messagingCommandError } from "@/lib/messaging-api";
import { scheduleOptions } from "@/lib/scheduled";
import { showToast } from "@/lib/toast";

/**
 * The email composer. A reply or reply all answers one message, named above the fields; a forward and a new email
 * start a new thread from a mailbox. To and Cc are chips. Files ride along with checkboxes: a reply all can carry the
 * thread's files again, a forward carries the original's, and Attach adds one from the device. Enter adds a line and
 * ⌘Enter sends. A reply goes through the pending-send lifecycle, so its card shows at once and becomes Gmail's
 * message; Send later schedules it in Convex.
 */

/** The message a reply or forward is made from, with what the composer says about it. */
export type ComposerSource = ReplySource & { guid: string; name: string; date: number; text: string };

export type ComposerStart =
  | { mode: ReplyMode; replyTo: ComposerSource; files?: readonly MailFile[]; text?: string; note?: string }
  | { mode: "forward"; replyTo: ComposerSource; files: readonly MailFile[] }
  | { mode: "new" };

export interface Mailbox {
  _id: string;
  label: string;
  gmailApp?: "workspace" | "personal";
}

type File = MailFile & { on: boolean };

const mailboxName = (mailbox: Mailbox) => (mailbox.gmailApp === "personal" ? "Personal" : "AUF");

export function EmailComposer({ conversationId, accountId, mailboxes, start, subject, self, hasDraft, onClose }: {
  /** The thread a reply goes into; a forward and a new email have none. */
  conversationId: ConversationId | null;
  /** The thread's mailbox, which a forward sends from. */
  accountId: string | null;
  /** The connected mailboxes a new email can come from. */
  mailboxes: readonly Mailbox[];
  start: ComposerStart;
  subject: string;
  self: ReadonlySet<string>;
  hasDraft: boolean;
  onClose: () => void;
}): JSX.Element {
  const theme = useTheme();
  const [mode, setMode] = useState(start.mode);
  const source = start.mode === "new" ? null : start.replyTo;
  const initial = start.mode === "reply" || start.mode === "replyAll" ? replyRecipients(start.replyTo, start.mode, self) : { to: [], cc: [] };
  const [to, setTo] = useState<MailAddress[]>(initial.to);
  const [cc, setCc] = useState<MailAddress[]>(initial.cc);
  const [typed, setTyped] = useState({ to: "", cc: "" });
  const [subjectText, setSubject] = useState(start.mode === "new" ? "" : start.mode === "forward" ? forwardSubject(subject) : replySubject(subject));
  const [text, setText] = useState(start.mode === "reply" || start.mode === "replyAll" ? start.text ?? "" : "");
  const [files, setFiles] = useState<File[]>(start.mode === "new" ? [] : (start.files ?? []).map((file) => ({ ...file, on: true })));
  const [from, setFrom] = useState(start.mode === "new" ? mailboxes[0]?._id ?? null : accountId);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const showSheet = useActionSheet();
  const replying = mode === "reply" || mode === "replyAll";
  const allTo = [...to, ...parseTyped(typed.to)];
  const allCc = [...cc, ...parseTyped(typed.cc)];
  const ready = !sending && uploading === 0 && (text.trim().length > 0 || mode === "forward") && allTo.length + allCc.length > 0 && from !== null;
  const attachments = files.filter((file) => file.on).map(({ storageId, filename, mimeType }) => ({ storageId, filename, mimeType }));
  const email = { to: allTo.map(mailboxText), cc: allCc.map(mailboxText), subject: subjectText.trim(), ...(attachments.length ? { attachments } : {}) };
  const reply = (body: string) => ({ kind: "send" as const, text: body, replyToGuid: source!.guid, email });
  const clearDraft = () => conversationId
    ? import("@/lib/identity").then(({ convexClient }) => convexClient.mutation(commaDraftsApi.clearDraft, { conversationId }))
    : Promise.resolve(null);

  /** Reply and Reply all swap the recipients each fills in, and keep the ones the user added. */
  const switchMode = (next: ReplyMode) => {
    if (!source || (mode !== "reply" && mode !== "replyAll")) return;
    const before = replyRecipients(source, mode, self);
    const filled = new Set([...before.to, ...before.cc].map((chip) => chip.address));
    const added = (chips: MailAddress[]) => chips.filter((chip) => !filled.has(chip.address));
    const recipients = replyRecipients(source, next, self);
    const keep = (base: MailAddress[], extra: MailAddress[]) => [...base, ...extra.filter((chip) => !base.some((b) => b.address === chip.address))];
    setMode(next);
    setTo(keep(recipients.to, added(to)));
    setCc(keep(recipients.cc, added(cc)));
  };

  const discard = () => {
    if (hasDraft) void clearDraft().catch(() => showToast("Couldn't discard the draft."));
    onClose();
  };

  const refused = (failure: unknown) => {
    setSending(false);
    setError(messagingCommandError(failure, "Couldn't send the email."));
  };

  const send = () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    if (replying && conversationId) {
      // Refused at enqueue, the composer is still open and says why. After it closes, the card shows the outcome.
      runCommand(conversationId, reply(text), { onQueued: onClose }).catch(refused);
      return;
    }
    // A new email or forward has no card to show its outcome, so the composer holds what was written until Gmail has it.
    const body = mode === "forward" && source ? forwardText(text, { ...source, subject }) : text;
    runCommand(null, { kind: "sendEmail", accountId: from as GenericId<"comma_accounts">, text: body, email }).then(() => {
      showToast("Email sent");
      onClose();
    }).catch(refused);
  };

  const schedule = async (body: string, sendAt: number): Promise<void> => {
    if (!conversationId) return;
    const { convexClient } = await import("@/lib/identity");
    await convexClient.mutation(scheduledSendsApi.schedule, { conversationId, payload: reply(body), sendAt });
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
        setError(messagingCommandError(failure, "Couldn't schedule the email."));
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

  // Loaded on use, as the chat composer loads them, so Mail's first visit carries neither picker nor uploader.
  const attach = async () => {
    const [{ pickFiles }, { storeAttachment }] = await Promise.all([import("@/lib/attachment-pickers"), import("@/lib/attachment-upload")]);
    const assets = await pickFiles();
    setUploading((count) => count + assets.length);
    await Promise.all(assets.map(async (asset) => {
      try {
        const stored = await storeAttachment({ uri: asset.uri, filename: asset.name, mimeType: asset.mime });
        setFiles((current) => [...current, { storageId: stored.storageId, filename: asset.name, mimeType: asset.mime, size: stored.size, on: true }]);
      } catch {
        showToast(`Couldn't attach ${asset.name}.`);
      } finally {
        setUploading((count) => count - 1);
      }
    }));
  };

  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent as TextInputKeyPressEventData & { metaKey?: boolean; ctrlKey?: boolean };
    if (key.key !== "Enter" || !(key.metaKey || key.ctrlKey)) return;
    event.preventDefault();
    send();
  };

  const recipients = (label: "To" | "Cc", value: MailAddress[], set: (next: MailAddress[]) => void, field: "to" | "cc") => (
    <RecipientField
      label={label}
      value={value}
      typed={typed[field]}
      onTyped={(next) => setTyped((current) => ({ ...current, [field]: next }))}
      onChange={set}
      onKeyPress={onKeyPress}
    />
  );

  const heading = mode === "forward" ? "Forward" : mode === "new" ? "New email" : null;
  return (
    <View testID="email-composer" style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.divider }]}>
      <View style={styles.top}>
        {heading ? <Text accessibilityRole="header" style={[styles.modeText, { color: theme.text }]}>{heading}</Text> : (
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
        )}
        <Pressable accessibilityRole="button" onPress={discard} hitSlop={8}>
          <Text style={[styles.discard, { color: theme.textSecondary }]}>Discard</Text>
        </Pressable>
      </View>
      {source ? (
        <Text testID="composer-source" numberOfLines={1} style={[styles.source, { color: theme.textSecondary }]}>
          {mode === "forward" ? "Forwarding" : "Replying to"} {source.name}, {formatReceiptTime(source.date)}
          <Text style={{ color: theme.textTertiary }}>{`  ${source.text.replace(/\s+/g, " ").trim()}`}</Text>
        </Text>
      ) : null}
      {mode === "new" && mailboxes.length > 1 ? (
        <View style={[styles.field, { borderBottomColor: theme.divider }]}>
          <Text style={[styles.label, { color: theme.textTertiary }]}>From</Text>
          <View role="radiogroup" accessibilityLabel="From" style={styles.chips}>
            {mailboxes.map((mailbox) => (
              <Pressable
                key={mailbox._id}
                role="radio"
                aria-checked={from === mailbox._id}
                accessibilityLabel={`${mailboxName(mailbox)}, ${mailbox.label}`}
                onPress={() => setFrom(mailbox._id)}
                style={[styles.chip, { backgroundColor: from === mailbox._id ? theme.rowSelected : "transparent", borderColor: theme.divider }]}
              >
                <Text style={[styles.chipText, { color: theme.text }]}>{mailboxName(mailbox)}</Text>
                <Text style={[styles.chipNote, { color: theme.textTertiary }]}>{mailbox.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {recipients("To", to, setTo, "to")}
      {recipients("Cc", cc, setCc, "cc")}
      <View style={[styles.field, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.label, { color: theme.textTertiary }]}>Subject</Text>
        <TextInput
          accessibilityLabel="Subject"
          value={subjectText}
          onChangeText={setSubject}
          onKeyPress={onKeyPress}
          style={[styles.input, { color: theme.text }, Platform.OS === "web" && styles.webInput]}
        />
      </View>
      {start.mode !== "new" && start.mode !== "forward" && start.note ? <Text style={[styles.note, { color: theme.textSecondary }]}>{start.note}</Text> : null}
      <TextInput
        accessibilityLabel="Message"
        placeholder={mode === "forward" ? "Add a note" : mode === "new" ? "Write an email" : "Write a reply"}
        placeholderTextColor={theme.textTertiary}
        value={text}
        onChangeText={setText}
        onKeyPress={onKeyPress}
        multiline
        autoFocus={mode !== "new"}
        style={[styles.body, { color: theme.text }, Platform.OS === "web" && styles.webInput]}
      />
      {files.length ? (
        <View accessibilityLabel="Attachments" style={styles.files}>
          {files.map((file, index) => (
            <Pressable
              key={file.storageId}
              role="checkbox"
              aria-checked={file.on}
              accessibilityLabel={`Include ${file.filename}`}
              onPress={() => setFiles((current) => current.map((candidate, at) => (at === index ? { ...candidate, on: !candidate.on } : candidate)))}
              style={[styles.file, { borderColor: theme.divider, opacity: file.on ? 1 : 0.55 }]}
            >
              <View style={[styles.box, { borderColor: file.on ? theme.accent : theme.dividerStrong, backgroundColor: file.on ? theme.accent : "transparent" }]}>
                {file.on ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              <Text numberOfLines={1} style={[styles.fileName, { color: theme.text }]}>{file.filename}</Text>
              {file.size ? <Text style={[styles.fileSize, { color: theme.textTertiary }]}>{formatFileSize(file.size)}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.bottom}>
        <Pressable accessibilityRole="button" accessibilityLabel="Attach files" onPress={() => void attach().catch(() => showToast("Couldn't attach the file."))} hitSlop={6}>
          <Text style={[styles.attach, { color: theme.accent }]}>{uploading ? "Attaching…" : "Attach"}</Text>
        </Pressable>
        <Text style={[styles.hint, { color: error ? theme.destructive : theme.textTertiary }]} numberOfLines={2}>
          {error ?? (Platform.OS === "web" ? "⌘↩ to send" : "")}
        </Text>
        {replying ? (
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
        ) : null}
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
      {replying ? (
        <ScheduleEditor
          visible={picking}
          title="Send Email Later"
          initialText={text}
          initialSendAt={Date.now() + 3_600_000}
          textEditable={false}
          onClose={() => setPicking(false)}
          onSubmit={(body, sendAt) => schedule(body, sendAt)}
        />
      ) : null}
    </View>
  );
}

/** To or Cc: a chip per address, each removable, and a field whose text becomes chips at a comma, Enter or blur. */
function RecipientField({ label, value, typed, onTyped, onChange, onKeyPress }: {
  label: string;
  value: MailAddress[];
  typed: string;
  onTyped: (text: string) => void;
  onChange: (next: MailAddress[]) => void;
  onKeyPress: (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
}): JSX.Element {
  const theme = useTheme();
  const commit = (text: string) => {
    const added = parseTyped(text).filter((address) => !value.some((chip) => chip.address === address.address));
    if (added.length) onChange([...value, ...added]);
    onTyped(parseTyped(text).length ? "" : text);
  };
  return (
    <View style={[styles.field, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text>
      <View style={styles.chips}>
        {value.map((chip) => (
          <Pressable
            key={chip.address}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${chip.name ?? chip.address} from ${label}`}
            onPress={() => onChange(value.filter((candidate) => candidate.address !== chip.address))}
            style={[styles.chip, { backgroundColor: theme.rowHover, borderColor: theme.divider }]}
          >
            <Text testID="recipient-chip" numberOfLines={1} style={[styles.chipText, { color: theme.text }]}>{chip.name ?? chip.address}</Text>
            <Text style={[styles.chipNote, { color: theme.textTertiary }]}>×</Text>
          </Pressable>
        ))}
        <TextInput
          accessibilityLabel={label}
          value={typed}
          onChangeText={(text) => (/[,;]\s*$/.test(text) ? commit(text) : onTyped(text))}
          onSubmitEditing={() => commit(typed)}
          onBlur={() => commit(typed)}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Backspace" && !typed && value.length) onChange(value.slice(0, -1));
            onKeyPress(event);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="email"
          style={[styles.input, styles.chipInput, { color: theme.text }, Platform.OS === "web" && styles.webInput]}
        />
      </View>
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
  source: { fontSize: 12.5, paddingBottom: 4 },
  field: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, paddingVertical: 6 },
  label: { fontSize: 13, width: 56 },
  input: { flex: 1, fontSize: 14, paddingVertical: 2 },
  chipInput: { minWidth: 140 },
  webInput: { outlineStyle: "none" } as object,
  chips: { alignItems: "center", flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { alignItems: "center", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 6, maxWidth: 280, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: "500" },
  chipNote: { fontSize: 12 },
  note: { fontSize: 12.5, fontStyle: "italic", paddingTop: 8 },
  body: { fontSize: 14, lineHeight: 21, minHeight: 120, paddingTop: 10, textAlignVertical: "top" },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 6 },
  file: { alignItems: "center", borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, maxWidth: 320, paddingHorizontal: 10, paddingVertical: 6 },
  box: { alignItems: "center", borderRadius: 4, borderWidth: 1.5, height: 16, justifyContent: "center", width: 16 },
  tick: { color: "#fff", fontSize: 11, fontWeight: "700", lineHeight: 13 },
  fileName: { flexShrink: 1, fontSize: 13 },
  fileSize: { fontSize: 12 },
  bottom: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between", paddingTop: 6 },
  attach: { fontSize: 14, fontWeight: "600" },
  hint: { flex: 1, fontSize: 12 },
  later: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 7 },
  laterText: { fontSize: 14, fontWeight: "600" },
  send: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
