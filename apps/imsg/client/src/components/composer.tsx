import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

function tempMessage(chatGuid: string, text: string, replyTo: Message | null): Message {
  return {
    guid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatGuid,
    text,
    dateCreated: Date.now(),
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: "iMessage",
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
  const insets = useSafeAreaInsets();
  const showSheet = useActionSheet();
  const [text, setText] = useState(() => getDraft(chatGuid));
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const typingActive = useRef(false);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // Swap drafts when the conversation changes.
  useEffect(() => {
    setText(getDraft(chatGuid));
  }, [chatGuid]);

  useEffect(() => {
    if (editing) setText(editing.text);
  }, [editing]);

  // Desktop web: autofocus on chat open, and typing anywhere focuses the composer.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || window.innerWidth < 768) return;
    inputRef.current?.focus();
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const inField =
        active instanceof HTMLElement &&
        (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable);
      if (inField) return;
      if (event.key.length === 1) {
        inputRef.current?.focus();
        setText((t) => t + event.key);
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onGlobalKeyDown);
    return () => document.removeEventListener("keydown", onGlobalKeyDown);
  }, [chatGuid]);

  // Desktop web: Enter sends, Shift+Enter newlines (RN multiline swallows submit on web).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
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
    if (!trimmed) return;

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
    const temp = tempMessage(chatGuid, trimmed, replyTo);
    const reply = replyTo;
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
      onSettled(temp.guid, message);
    } catch {
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
    }
  };

  sendRef.current = () => void send();

  const uploadAsset = async (uri: string, name: string, mimeType: string, caption?: string) => {
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("attachment", new File([blob], name));
    } else {
      form.append("attachment", { uri, name, type: mimeType } as unknown as Blob);
    }
    if (caption) form.append("caption", caption);
    const res = await fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/attachment`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(String(res.status));
    onSent((await res.json()) as Message);
  };

  // Any text in the box rides along as the caption on the first attachment.
  const consumeCaption = (): string | undefined => {
    const caption = text.trim();
    if (caption) {
      setText("");
      setDraft(chatGuid, "");
    }
    return caption || undefined;
  };

  const runUploads = async (assets: Array<{ uri: string; name: string; mime: string }>) => {
    if (assets.length === 0) return;
    setBusy(true);
    const caption = consumeCaption();
    try {
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        if (!a) continue;
        await uploadAsset(a.uri, a.name, a.mime, i === 0 ? caption : undefined);
      }
      playSend();
    } catch {
      showToast("Attachment failed");
    } finally {
      setBusy(false);
    }
  };

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.9,
    });
    await runUploads(
      (result.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`,
        mime: asset.mimeType ?? "image/jpeg",
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
    await runUploads(
      (result.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`,
        mime: asset.mimeType ?? "image/jpeg",
      })),
    );
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (result.canceled) return;
    await runUploads(
      (result.assets ?? []).map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? "application/octet-stream",
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
  const canSend = text.trim().length > 0;

  return (
    <View
      style={[
        styles.container,
        { borderTopColor: theme.divider, paddingBottom: Math.max(6, insets.bottom) },
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
            onChangeText={onChangeText}
            placeholder={editing ? "Edit message" : "iMessage"}
            placeholderTextColor={theme.textSecondary}
            multiline
            enterKeyHint="send"
            submitBehavior="submit"
            onSubmitEditing={() => void send()}
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
            style={[styles.sendButton, { backgroundColor: theme.bubbleMine }]}
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
