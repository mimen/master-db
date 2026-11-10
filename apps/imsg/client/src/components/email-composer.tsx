import { forwardSubject, forwardText, mailboxText, parseTyped, replyRecipients, replySubject, type MailAddress, type ReplyMode, type ReplySource } from "@shared/email-reply";
import type { ConversationId } from "@shared/types";
import type { GenericId } from "convex/values";
import { useState, type JSX } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";

import { ChipField, ComposeSheet, FromChip, SheetField, SheetFooter, WEB_INPUT, type Mailbox } from "@/components/compose-sheet";
import { formatFileSize } from "@/components/message-meta";
import { ScheduleEditor } from "@/components/schedule-editor";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { CommandExecutionError, UnknownCommandError } from "@/lib/command-results";
import { commaDraftsApi, scheduledSendsApi } from "@/lib/convex-api";
import { runCommand } from "@/lib/convex-commands";
import { formatReceiptTime } from "@/lib/format";
import type { MailFile } from "@/lib/mail";
import { messagingCommandError } from "@/lib/messaging-api";
import { scheduleOptions } from "@/lib/scheduled";
import { showToast } from "@/lib/toast";

/**
 * The email composer, on the compose sheet's parts. A new email and a forward open as the sheet; a reply or reply all
 * docks in the reader under the message it answers. To and Cc are chips, and the From chip shows the mailbox whenever
 * more than one is connected. Files ride along with checkboxes: a forward carries the original's checked, an agent's
 * draft carries its own checked, and a reply all offers the thread's files unchecked, one tap each to include. Attach
 * adds one from the device. Enter adds a line and ⌘Enter sends. A reply goes through the pending-send lifecycle, so its
 * card shows at once and becomes Gmail's message; Send later schedules it in Convex.
 */

/** The message a reply or forward is made from, with what the composer says about it. */
export type ComposerSource = ReplySource & { guid: string; name: string; date: number; text: string };

/** A file the email can carry. `offered` marks one of the thread's files a reply all lists unchecked; a plain reply leaves those out. */
export type ComposerFile = MailFile & { on: boolean; offered?: boolean };

export type ComposerStart =
  | { mode: ReplyMode; replyTo: ComposerSource; files?: readonly ComposerFile[]; text?: string; note?: string }
  | { mode: "forward"; replyTo: ComposerSource; files: readonly MailFile[] }
  | { mode: "new" };

export function EmailComposer({ conversationId, accountId, mailboxes, start, subject, self, hasDraft, onClose }: {
  /** The thread a reply goes into; a forward and a new email have none. */
  conversationId: ConversationId | null;
  /** The mailbox it goes out from: the thread's for a reply or forward, the narrowed one for a new email. */
  accountId: string | null;
  /** The connected mailboxes. A new email or forward can switch between them; a reply shows its own. */
  mailboxes: readonly Mailbox[];
  start: ComposerStart;
  subject: string;
  self: ReadonlySet<string>;
  hasDraft: boolean;
  onClose: () => void;
}): JSX.Element {
  const theme = useTheme();
  // A key hint is for a keyboard: the narrow layout is a phone's.
  const { wide } = useLayoutMode();
  const [mode, setMode] = useState(start.mode);
  const source = start.mode === "new" ? null : start.replyTo;
  const initial = start.mode === "reply" || start.mode === "replyAll" ? replyRecipients(start.replyTo, start.mode, self) : { to: [], cc: [] };
  const [to, setTo] = useState<MailAddress[]>(initial.to);
  const [cc, setCc] = useState<MailAddress[]>(initial.cc);
  const [typed, setTyped] = useState({ to: "", cc: "" });
  const [subjectText, setSubject] = useState(start.mode === "new" ? "" : start.mode === "forward" ? forwardSubject(subject) : replySubject(subject));
  const [text, setText] = useState(start.mode === "reply" || start.mode === "replyAll" ? start.text ?? "" : "");
  const [files, setFiles] = useState<ComposerFile[]>(start.mode === "new" ? []
    : start.mode === "forward" ? start.files.map((file) => ({ ...file, on: true })) : [...start.files ?? []]);
  const [from, setFrom] = useState(accountId ?? mailboxes[0]?._id ?? null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const showSheet = useActionSheet();
  const replying = mode === "reply" || mode === "replyAll";
  const listed = files.filter((file) => mode !== "reply" || !file.offered);
  const allTo = [...to, ...parseTyped(typed.to)];
  const allCc = [...cc, ...parseTyped(typed.cc)];
  const ready = !sending && uploading === 0 && (text.trim().length > 0 || mode === "forward") && allTo.length + allCc.length > 0 && from !== null;
  const dirty = text.trim() !== "" || (mode === "new" && (allTo.length + allCc.length > 0 || subjectText.trim() !== ""));
  const attachments = listed.filter((file) => file.on).map(({ storageId, filename, mimeType }) => ({ storageId, filename, mimeType }));
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
    // The lane's refusal reads as the reply card's does.
    setError(failure instanceof CommandExecutionError && !(failure instanceof UnknownCommandError)
      ? `Couldn't send: ${failure.message}` : messagingCommandError(failure, "Couldn't send the email."));
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

  /** To or Cc: typed text becomes chips at a comma, Enter or blur. */
  const recipients = (label: "To" | "Cc", value: MailAddress[], set: (next: MailAddress[]) => void, field: "to" | "cc") => {
    const commit = (input: string) => {
      const added = parseTyped(input).filter((address) => !value.some((chip) => chip.address === address.address));
      if (added.length) set([...value, ...added]);
      setTyped((current) => ({ ...current, [field]: parseTyped(input).length ? "" : input }));
    };
    return (
      <ChipField
        label={label}
        chips={value.map((chip) => ({ key: chip.address, label: chip.name ?? chip.address }))}
        onRemove={(address) => set(value.filter((chip) => chip.address !== address))}
        input={{
          value: typed[field],
          onChangeText: (next) => (/[,;]\s*$/.test(next) ? commit(next) : setTyped((current) => ({ ...current, [field]: next }))),
          onSubmitEditing: () => commit(typed[field]),
          onBlur: () => commit(typed[field]),
          onKeyPress,
          inputMode: "email",
          autoFocus: !replying && field === "to",
        }}
      />
    );
  };

  const docked = replying;
  const header = docked ? (
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
  ) : undefined;
  return (
    <ComposeSheet
      testID="email-composer"
      title={mode === "forward" ? "Forward email" : mode === "new" ? "New email" : mode === "reply" ? "Reply" : "Reply all"}
      header={header}
      presentation={docked ? "docked" : "overlay"}
      dirty={dirty}
      onClose={discard}
    >
      {source ? (
        <Text testID="composer-source" numberOfLines={1} style={[styles.source, { color: theme.textSecondary }]}>
          {mode === "forward" ? "Forwarding" : "Replying to"} {source.name}, {formatReceiptTime(source.date)}
          <Text style={{ color: theme.textTertiary }}>{`  ${source.text.replace(/\s+/g, " ").trim()}`}</Text>
        </Text>
      ) : null}
      {mailboxes.length > 1 ? <FromChip mailboxes={mailboxes} value={from} {...(docked ? {} : { onChange: setFrom })} /> : null}
      {recipients("To", to, setTo, "to")}
      {recipients("Cc", cc, setCc, "cc")}
      <SheetField label="Subject">
        <TextInput
          accessibilityLabel="Subject"
          value={subjectText}
          onChangeText={setSubject}
          onKeyPress={onKeyPress}
          style={[styles.input, { color: theme.text }, WEB_INPUT]}
        />
      </SheetField>
      {start.mode !== "new" && start.mode !== "forward" && start.note ? <Text style={[styles.note, { color: theme.textSecondary }]}>{start.note}</Text> : null}
      <TextInput
        accessibilityLabel="Message"
        placeholder={mode === "forward" ? "Add a note" : mode === "new" ? "Write an email" : "Write a reply"}
        placeholderTextColor={theme.textTertiary}
        value={text}
        onChangeText={setText}
        onKeyPress={onKeyPress}
        multiline
        autoFocus={replying}
        style={[styles.body, docked ? styles.dockedBody : styles.sheetBody, { color: theme.text }, WEB_INPUT]}
      />
      {listed.length ? (
        <View accessibilityLabel="Attachments" style={styles.files}>
          {listed.map((file) => (
            <Pressable
              key={file.storageId}
              role="checkbox"
              aria-checked={file.on}
              accessibilityLabel={`Include ${file.filename}`}
              onPress={() => setFiles((current) => current.map((candidate) => (candidate.storageId === file.storageId ? { ...candidate, on: !candidate.on } : candidate)))}
              style={[styles.file, { borderColor: theme.divider, opacity: file.on ? 1 : 0.6 }]}
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
      <SheetFooter
        onAttach={() => void attach().catch(() => showToast("Couldn't attach the file."))}
        attaching={uploading > 0}
        note={uploading ? "Attaching…" : wide ? "⌘↩ to send" : undefined}
        error={error}
        {...(replying ? { onLater: openLater } : {})}
        ready={ready}
        sending={sending}
        onSend={send}
      />
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
    </ComposeSheet>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: "row", gap: 4 },
  mode: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 4 },
  modeText: { fontSize: 13, fontWeight: "600" },
  source: { fontSize: 12.5, paddingBottom: 6, paddingHorizontal: 16, paddingTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 2 },
  note: { fontSize: 12.5, fontStyle: "italic", paddingHorizontal: 16, paddingTop: 8 },
  body: { fontSize: 14, lineHeight: 21, paddingHorizontal: 16, paddingTop: 10, textAlignVertical: "top" },
  sheetBody: { flex: 1 },
  dockedBody: { minHeight: 120 },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 8, paddingHorizontal: 16 },
  file: { alignItems: "center", borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, maxWidth: 320, paddingHorizontal: 10, paddingVertical: 6 },
  box: { alignItems: "center", borderRadius: 4, borderWidth: 1.5, height: 16, justifyContent: "center", width: 16 },
  tick: { color: "#fff", fontSize: 11, fontWeight: "700", lineHeight: 13 },
  fileName: { flexShrink: 1, fontSize: 13 },
  fileSize: { fontSize: 12 },
});
