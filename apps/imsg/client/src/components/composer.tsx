import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { showToast } from "@/lib/toast";
import { playSend } from "@/lib/sounds";
import { useActionSheet } from "@/lib/action-sheet";
import { api } from "@/lib/api";
import { BASE_URL } from "@/lib/config";
import { getDraft, setDraft } from "@/lib/drafts";
import { registerFocusTarget, setListMode } from "@/lib/keyboard/controller";
import type { Message } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";

interface ComposerProps {
  chatGuid: string;
  replyTo: Message | null;
  editing: Message | null;
  onClearReply: () => void;
  onClearEditing: () => void;
  onEdited: (message: Message) => void;
  onOptimistic: (message: Message) => void;
  onSettled: (tempGuid: string, message: Message) => void;
  onSent: (message: Message) => void;
}

interface PendingAttachment {
  uri: string;
  name: string;
  mime: string;
  isImage: boolean;
}

/** SMS/RCS conversations have an "SMS;" guid prefix — green bubbles. */
function chatIsSMS(chatGuid: string): boolean {
  return chatGuid.startsWith("SMS");
}

function tempMessage(chatGuid: string, text: string, replyTo: Message | null): Message {
  return {
    guid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatGuid,
    text,
    dateCreated: Date.now(),
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: chatIsSMS(chatGuid) ? "SMS" : "iMessage",
    sender: null,
    attachments: [],
    special: null,
    sendEffect: null,
    reactions: [],
    replyToGuid: replyTo?.guid ?? null,
    replyToPreview: replyTo ? replyTo.text.slice(0, 120) : null,
    replyToFromMe: replyTo?.isFromMe ?? null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    pending: true,
  };
}

/** Quick relative schedule targets, iMessage "Send Later" style. */
function scheduleOptions(): Array<{ label: string; at: number }> {
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  const tomorrowAm = new Date(now);
  tomorrowAm.setDate(now.getDate() + 1);
  tomorrowAm.setHours(9, 0, 0, 0);
  const opts = [
    { label: "In 1 hour", at: now.getTime() + 3_600_000 },
    { label: "In 3 hours", at: now.getTime() + 3 * 3_600_000 },
  ];
  if (tonight.getTime() > now.getTime()) opts.push({ label: "Tonight, 8 PM", at: tonight.getTime() });
  opts.push({ label: "Tomorrow, 9 AM", at: tomorrowAm.getTime() });
  return opts;
}

export function Composer({
  chatGuid,
  replyTo,
  editing,
  onClearReply,
  onClearEditing,
  onEdited,
  onOptimistic,
  onSettled,
  onSent,
}: ComposerProps) {
  const theme = useTheme();
  const showSheet = useActionSheet();
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [text, setText] = useState(() => getDraft(chatGuid));
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  // The home-indicator inset is only meaningful when the keyboard is down; when
  // it's up the keyboard covers that area, so drop the padding to avoid a gap.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardWillShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const sendInFlight = useRef(false);
  const typingActive = useRef(false);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // Swap drafts when the conversation changes.
  useEffect(() => {
    setText(getDraft(chatGuid));
    setPending([]);
  }, [chatGuid]);

  useEffect(() => {
    if (editing) setText(editing.text);
  }, [editing]);

  // Desktop web: the composer is a keyboard focus target — reply-intent
  // selections request it (docs/keyboard-design.md). Type-anywhere is gone: it
  // can't coexist with glide-mode single keys, and its char-append was wrong
  // for IME/dead-key/emoji input anyway.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || window.innerWidth < 768) return;
    return registerFocusTarget("composer", () => inputRef.current?.focus());
  }, [chatGuid]);

  // Desktop web: Enter sends, Shift+Enter newlines (RN multiline swallows
  // submit on web). Guards: IME composition, key repeat, in-flight send.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (event.isComposing || event.repeat || sendInFlight.current) return;
        sendRef.current();
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, []);

  const setTyping = (active: boolean) => {
    if (typingActive.current === active) return;
    typingActive.current = active;
    void fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    }).catch(() => undefined);
  };

  const onChangeText = (value: string) => {
    setText(value);
    if (!editing) {
      setDraft(chatGuid, value);
      setTyping(value.length > 0);
      if (typingIdle.current) clearTimeout(typingIdle.current);
      typingIdle.current = setTimeout(() => setTyping(false), 5000);
    }
  };

  const sendRef = useRef<() => void>(() => undefined);
  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;

    if (editing) {
      setBusy(true);
      try {
        await api.edit(editing.guid, trimmed);
        onEdited({ ...editing, text: trimmed, edited: true });
        setText("");
        onClearEditing();
      } catch {
        showToast("Edit failed — edits are only allowed for ~15 minutes");
      } finally {
        setBusy(false);
      }
      return;
    }

    setTyping(false);

    // Send staged attachments first (text rides the first one as caption).
    if (pending.length > 0) {
      const attachments = pending;
      const caption = trimmed || undefined;
      setPending([]);
      setText("");
      setDraft(chatGuid, "");
      setBusy(true);
      try {
        for (let i = 0; i < attachments.length; i++) {
          const a = attachments[i];
          if (a) await uploadAsset(a, i === 0 ? caption : undefined);
        }
        playSend();
      } catch {
        showToast("Attachment failed");
      } finally {
        setBusy(false);
      }
      return;
    }

    const temp = tempMessage(chatGuid, trimmed, replyTo);
    const reply = replyTo;
    sendInFlight.current = true;
    setText("");
    setDraft(chatGuid, "");
    onClearReply();
    onOptimistic(temp);
    try {
      const message = await api.sendText(chatGuid, {
        text: trimmed,
        replyToGuid: reply?.guid,
      });
      playSend();
      // BlueBubbles can echo a freshly-sent SMS back as "iMessage" before it
      // reclassifies — pin the service so the green bubble never flashes blue.
      onSettled(temp.guid, chatIsSMS(chatGuid) ? { ...message, service: "SMS" } : message);
    } catch {
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
    } finally {
      sendInFlight.current = false;
    }
  };

  sendRef.current = () => void send();

  const uploadAsset = async (att: PendingAttachment, caption?: string) => {
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(att.uri)).blob();
      form.append("attachment", new File([blob], att.name));
    } else {
      form.append("attachment", { uri: att.uri, name: att.name, type: att.mime } as unknown as Blob);
    }
    if (caption) form.append("caption", caption);
    const res = await fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/attachment`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(String(res.status));
    onSent((await res.json()) as Message);
  };

  // Attachments are staged as drafts above the composer; nothing sends until
  // the user hits the send button.
  const stage = (assets: PendingAttachment[]) => {
    if (assets.length > 0) setPending((cur) => [...cur, ...assets].slice(0, 10));
  };

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.9,
    });
    stage(
      (result.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`,
        mime: asset.mimeType ?? "image/jpeg",
        isImage: (asset.mimeType ?? "image/jpeg").startsWith("image/"),
      })),
    );
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showToast("Camera permission denied");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, mediaTypes: ["images", "videos"] });
    stage(
      (result.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`,
        mime: asset.mimeType ?? "image/jpeg",
        isImage: (asset.mimeType ?? "image/jpeg").startsWith("image/"),
      })),
    );
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (result.canceled) return;
    stage(
      (result.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? "application/octet-stream",
        isImage: (asset.mimeType ?? "").startsWith("image/"),
      })),
    );
  };

  const openAttachSheet = () => {
    const actions = [{ label: "Photo or Video Library", onPress: () => void pickPhotos() }];
    if (Platform.OS !== "web") {
      actions.unshift({ label: "Take Photo or Video", onPress: () => void takePhoto() });
    }
    actions.push({ label: "File", onPress: () => void pickFiles() });
    showSheet({ actions });
  };

  // ---------------------------------------------------------- voice memo
  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        showToast("Microphone permission denied");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      showToast("Couldn't start recording");
    }
  };

  const stopRecordingAndSend = async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      setBusy(true);
      const form = new FormData();
      const name = `voice-${Date.now()}.m4a`;
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        form.append("attachment", new File([blob], name));
      } else {
        form.append("attachment", { uri, name, type: "audio/mp4" } as unknown as Blob);
      }
      form.append("isAudioMessage", "true");
      const res = await fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/attachment`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        onSent((await res.json()) as Message);
        playSend();
      } else showToast("Voice message failed");
    } catch {
      showToast("Voice message failed");
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------- scheduled send
  const openScheduleSheet = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    showSheet({
      title: "Send later",
      actions: scheduleOptions().map((o) => ({
        label: o.label,
        onPress: () => {
          void api
            .schedule(chatGuid, trimmed, o.at)
            .then(() => {
              setText("");
              setDraft(chatGuid, "");
              showToast(`Scheduled ${o.label.toLowerCase()}`);
            })
            .catch(() => showToast("Couldn't schedule"));
        },
      })),
    });
  };

  const recording = recorderState.isRecording;
  const canSend = text.trim().length > 0 || pending.length > 0;
  const isSMS = chatIsSMS(chatGuid);
  const sendColor = isSMS ? "#34C759" : theme.bubbleMine;

  return (
    <View
      style={[
        styles.container,
        {
          borderTopColor: theme.divider,
          // Minimal bottom margin — the composer hugs the bottom edge.
          paddingBottom: keyboardUp ? 6 : 8,
          // Wider side margins at rest, full width while typing (iMessage-style).
          paddingHorizontal: keyboardUp ? 10 : 18,
        },
      ]}
    >
      {replyTo && !editing && (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <Text numberOfLines={1} style={[styles.bannerText, { color: theme.textSecondary }]}>
            Replying to: {replyTo.text.slice(0, 80) || "attachment"}
          </Text>
          <Pressable onPress={onClearReply} hitSlop={8}>
            <Text style={{ color: theme.textSecondary }}>✕</Text>
          </Pressable>
        </View>
      )}
      {editing && (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <Text numberOfLines={1} style={[styles.bannerText, { color: theme.text, fontWeight: "600" }]}>
            Editing message
          </Text>
          <Pressable
            onPress={() => {
              setText("");
              onClearEditing();
            }}
            hitSlop={8}
          >
            <Text style={{ color: theme.textSecondary }}>✕</Text>
          </Pressable>
        </View>
      )}
      {pending.length > 0 && (
        <View style={styles.pendingRow}>
          {pending.map((att, i) => (
            <View key={`${att.uri}-${i}`} style={styles.pendingItem}>
              {att.isImage ? (
                <Image source={{ uri: att.uri }} style={styles.pendingThumb} contentFit="cover" />
              ) : (
                <View style={[styles.pendingThumb, styles.pendingFile, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name="document-outline" size={22} color={theme.textSecondary} />
                </View>
              )}
              <Pressable
                onPress={() => setPending((cur) => cur.filter((_, j) => j !== i))}
                style={styles.pendingRemove}
                hitSlop={6}
              >
                <Ionicons name="close-circle" size={20} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={styles.inputRow}>
        <Pressable onPress={openAttachSheet} disabled={busy || recording} hitSlop={8} style={styles.attachButton}>
          <Ionicons name="add-circle-outline" size={26} color={theme.textSecondary} />
        </Pressable>
        {recording ? (
          <View style={[styles.input, styles.recordingBar, { borderColor: theme.divider }]}>
            <View style={styles.recDot} />
            <Text style={{ color: theme.text, fontSize: 15 }}>
              Recording {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s…
            </Text>
          </View>
        ) : (
          <TextInput
            ref={inputRef}
            value={text}
            onFocus={() => setListMode(false)}
            onChangeText={onChangeText}
            placeholder={editing ? "Edit message" : pending.length > 0 ? "Add a comment or Send" : isSMS ? "Text Message" : "iMessage"}
            placeholderTextColor={theme.textSecondary}
            multiline
            // Desktop: Enter sends (handled by the keydown listener above).
            // Mobile: Return inserts a newline; sending is the button only.
            enterKeyHint={Platform.OS === "web" ? "send" : "enter"}
            submitBehavior={Platform.OS === "web" ? "submit" : "newline"}
            onSubmitEditing={Platform.OS === "web" ? () => void send() : undefined}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.divider, backgroundColor: theme.background },
            ]}
          />
        )}
        {canSend && !recording ? (
          <Pressable
            onPress={() => void send()}
            onLongPress={editing ? undefined : openScheduleSheet}
            disabled={busy}
            style={[styles.sendButton, { backgroundColor: sendColor }]}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            onPressIn={editing ? undefined : startRecording}
            onPressOut={recording ? () => void stopRecordingAndSend() : undefined}
            disabled={busy || Boolean(editing)}
            style={[
              styles.sendButton,
              { backgroundColor: recording ? "#FF3B30" : theme.backgroundElement },
            ]}
          >
            <Ionicons name={recording ? "stop" : "mic"} size={19} color={recording ? "#fff" : theme.textSecondary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
    gap: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  attachButton: {
    paddingBottom: 7,
    paddingLeft: 2,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 17,
    maxHeight: 120,
  },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
  },
  pendingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  pendingItem: {
    position: "relative",
  },
  pendingThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  pendingFile: {
    alignItems: "center",
    justifyContent: "center",
  },
  pendingRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF3B30",
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
});
