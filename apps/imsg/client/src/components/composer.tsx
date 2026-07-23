import { useEffect, useRef, useState } from "react";
import { FlatList, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
import { initials } from "@/lib/format";
import { formatAddress } from "@shared/address";
import { registerFocusTarget, setListMode } from "@/lib/keyboard/controller";
import { onFillComposer } from "@/lib/composer-fill";
import type { Contact, Message } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";
import { CardShadow, Colors, Radii } from "@/constants/theme";

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
  /** Present when this pending item is a contact card, sent via the server. */
  contact?: Contact;
}

const IOS_INPUT_LINE_HEIGHT = 22;
/** The input's vertical padding (paddingTop 8 + paddingBottom 8 in styles.input).
 * iOS contentSize EXCLUDES padding — forgetting to add it back clips the text. */
const IOS_INPUT_PADDING_V = 16;
const IOS_INPUT_MIN_HEIGHT = IOS_INPUT_LINE_HEIGHT + IOS_INPUT_PADDING_V;
const IOS_INPUT_MAX_HEIGHT = IOS_INPUT_LINE_HEIGHT * 10 + IOS_INPUT_PADDING_V;

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

/** Searchable contact picker for attaching a contact card. */
function ContactPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (contact: Contact) => void;
}) {
  const theme = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .contacts(q)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, visible]);
  useEffect(() => {
    if (!visible) setQ("");
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={pickerStyles.backdrop} onPress={onClose}>
        <Pressable
          style={[pickerStyles.card, { backgroundColor: theme.background, borderColor: theme.divider }]}
          onPress={() => undefined}
        >
          <Text style={[pickerStyles.title, { color: theme.text }]}>Send Contact</Text>
          <View style={[pickerStyles.field, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="search" size={16} color={theme.textSecondary} />
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder="Search contacts"
              placeholderTextColor={theme.textSecondary}
              style={[pickerStyles.input, { color: theme.text }]}
            />
          </View>
          <FlatList
            data={results}
            keyExtractor={(c) => `${c.address}-${c.name}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [pickerStyles.row, pressed && { backgroundColor: theme.backgroundElement }]}
                onPress={() => onPick(item)}
              >
                <View style={[pickerStyles.avatar, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600" }}>
                    {initials(item.name || item.address)}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>
                    {item.name || formatAddress(item.address)}
                  </Text>
                  <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 12 }}>
                    {formatAddress(item.address)}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  const [inputHeight, setInputHeight] = useState(IOS_INPUT_MIN_HEIGHT);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  // Track native keyboard visibility for keyboard-specific composer edge spacing.
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
    setInputHeight(IOS_INPUT_MIN_HEIGHT);
    setPending([]);
  }, [chatGuid]);

  useEffect(() => {
    if (editing) setText(editing.text);
  }, [editing]);

  // Suggestion shelf drops text in here for editing; never auto-sends.
  useEffect(
    () =>
      onFillComposer((suggestion) => {
        setText(suggestion);
        setDraft(chatGuid, suggestion);
        inputRef.current?.focus();
      }),
    [chatGuid],
  );

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

  // iOS growth via a hidden mirror <Text> with identical font metrics: its
  // onLayout reports the TRUE text height, and since the mirror's height is
  // never controlled by us, no feedback loop is possible. (onContentSizeChange
  // is unusable on this Fabric build — it echoes the frame we set.)
  const onMirrorLayout = (height: number) => {
    const next = Math.min(
      Math.max(Math.ceil(height) + IOS_INPUT_PADDING_V, IOS_INPUT_MIN_HEIGHT),
      IOS_INPUT_MAX_HEIGHT,
    );
    setInputHeight((current) => (current === next ? current : next));
  };

  /** Programmatic clear (send/schedule/edit-cancel): text + growth reset together. */
  const clearText = () => {
    setText("");
    setInputHeight(IOS_INPUT_MIN_HEIGHT);
  };

  // Desktop web growth: the DOM textarea reports scrollHeight reliably —
  // classic autosize, same 10-line cap as iOS. Runs after every text commit
  // (clears included), so it also shrinks back.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node || !node.style) return;
    // Reset to the one-line floor BEFORE measuring: scrollHeight never reports
    // less than the current height, and RNW's empty textarea is ~2 rows tall —
    // resetting to "auto" made that the permanent minimum.
    node.style.height = `${IOS_INPUT_MIN_HEIGHT}px`;
    const next = Math.min(Math.max(node.scrollHeight, IOS_INPUT_MIN_HEIGHT), IOS_INPUT_MAX_HEIGHT);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > IOS_INPUT_MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  const sendRef = useRef<() => void>(() => undefined);
  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;

    if (editing) {
      setBusy(true);
      try {
        await api.edit(editing.guid, trimmed);
        onEdited({ ...editing, text: trimmed, edited: true });
        clearText();
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
      clearText();
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
    clearText();
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
    if (att.contact) {
      onSent(await api.sendContactCard(chatGuid, att.contact, caption));
      return;
    }
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

  const stageContact = (contact: Contact) => {
    stage([
      {
        uri: `contact:${contact.address}`,
        name: `${contact.name}.vcf`,
        mime: "text/vcard",
        isImage: false,
        contact,
      },
    ]);
  };

  const attachBtnRef = useRef<View>(null);
  const openAttachSheet = () => {
    const actions = [{ label: "Photo or Video Library", onPress: () => void pickPhotos() }];
    if (Platform.OS !== "web") {
      actions.unshift({ label: "Take Photo or Video", onPress: () => void takePhoto() });
    }
    actions.push({ label: "Contact", onPress: () => void setContactPickerOpen(true) });
    actions.push({ label: "File", onPress: () => void pickFiles() });
    // Desktop: popover mounted at the + button (opens upward); mobile keeps the sheet.
    if (Platform.OS === "web" && typeof window !== "undefined" && window.innerWidth >= 768 && attachBtnRef.current) {
      attachBtnRef.current.measureInWindow((x, y) => showSheet({ actions, anchor: { x, y } }));
    } else {
      showSheet({ actions });
    }
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
              clearText();
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
  const sendColor = isSMS ? theme.sms : theme.bubbleMine;

  return (
    <View
      style={[
        styles.container,
        {
          borderTopColor: theme.divider,
          // Keep native controls clear of the keyboard and rounded display edges.
          paddingBottom: 8,
          paddingHorizontal: Platform.OS === "web" ? 18 : keyboardUp ? 16 : 20,
        },
      ]}
    >
      <ContactPicker
        visible={contactPickerOpen}
        onClose={() => setContactPickerOpen(false)}
        onPick={(contact) => {
          stageContact(contact);
          setContactPickerOpen(false);
        }}
      />
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
              clearText();
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
                  <Ionicons
                    name={att.contact ? "person-circle-outline" : "document-outline"}
                    size={22}
                    color={theme.textSecondary}
                  />
                </View>
              )}
              <Pressable
                onPress={() => setPending((cur) => cur.filter((_, j) => j !== i))}
                style={styles.pendingRemove}
                hitSlop={6}
              >
                {/* Remove badge sits on a fixed dark scrim over an attachment thumbnail —
                    theme-invariant, not a theme.onAccent site. */}
                <Ionicons name="close-circle" size={20} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={styles.inputRow}>
        <View style={styles.actionCol}>
          <Pressable
            ref={attachBtnRef}
            onPress={openAttachSheet}
            disabled={busy || recording}
            hitSlop={8}
            style={[styles.sendButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Ionicons name="add" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
        {recording ? (
          <View style={[styles.input, styles.recordingBar, { borderColor: theme.divider }]}>
            <View style={styles.recDot} />
            <Text style={{ color: theme.text, fontSize: 15 }}>
              Recording {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s…
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {Platform.OS === "ios" && (
              <Text
                style={styles.growthMirror}
                onLayout={(e) => onMirrorLayout(e.nativeEvent.layout.height)}
              >
                {text.length === 0 ? " " : text.endsWith("\n") ? `${text} ` : text}
              </Text>
            )}
            <TextInput
              ref={inputRef}
              value={text}
              onFocus={() => setListMode(false)}
              onChangeText={onChangeText}
              placeholder={editing ? "Edit message" : pending.length > 0 ? "Add a comment or Send" : isSMS ? "Text Message" : "iMessage"}
              placeholderTextColor={theme.textSecondary}
              multiline
              scrollEnabled={Platform.OS === "ios" ? inputHeight >= IOS_INPUT_MAX_HEIGHT : undefined}
              // Desktop: Enter sends (handled by the keydown listener above).
              // Mobile: Return inserts a newline; sending is the button only.
              enterKeyHint={Platform.OS === "web" ? "send" : "enter"}
              submitBehavior={Platform.OS === "web" ? "submit" : "newline"}
              onSubmitEditing={Platform.OS === "web" ? () => void send() : undefined}
              style={[
                styles.input,
                Platform.OS === "ios" && {
                  height: inputHeight,
                  lineHeight: IOS_INPUT_LINE_HEIGHT,
                },
                { color: theme.text, borderColor: theme.divider, backgroundColor: theme.background },
              ]}
            />
          </View>
        )}
        <View style={styles.actionCol}>
          {canSend && !recording ? (
            <Pressable
              onPress={() => void send()}
              onLongPress={editing ? undefined : openScheduleSheet}
              disabled={busy}
              style={[styles.sendButton, { backgroundColor: sendColor }]}
            >
              <Ionicons name="arrow-up" size={20} color={theme.onAccent} />
            </Pressable>
          ) : (
            <Pressable
              onPressIn={editing ? undefined : startRecording}
              onPressOut={recording ? () => void stopRecordingAndSend() : undefined}
              disabled={busy || Boolean(editing)}
              style={[
                styles.sendButton,
                // Intentionally NOT theme.destructive: this literal is the
                // iOS system-red LIGHT variant, already correct in light mode.
                // Theming it would flip dark mode to #FF453A — an unauthorized
                // visual change outside this sweep's two approved exceptions.
                { backgroundColor: recording ? "#FF3B30" : theme.backgroundElement },
              ]}
            >
              <Ionicons name={recording ? "stop" : "mic"} size={19} color={recording ? theme.onAccent : theme.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    // Same value both schemes — Colors.backdrop, referenced directly since
    // this StyleSheet is static (outside any component/theme scope).
    backgroundColor: Colors.light.backdrop,
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    height: 480,
    maxHeight: "80%",
    maxWidth: "94%",
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 14,
    ...CardShadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 34,
    width: 400,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  field: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 7,
    height: 36,
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  row: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  avatar: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});

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
    alignItems: "flex-start",
    gap: 8,
  },
  growthMirror: {
    // Same metrics as the input's text area; invisible; never intercepts touch.
    fontSize: 17,
    left: 14,
    lineHeight: 22,
    opacity: 0,
    pointerEvents: "none",
    position: "absolute",
    right: 14,
    top: 0,
  },
  input: {
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 17,
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
    borderRadius: Radii.chip,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    // Intentionally NOT theme.destructive — see the recording-button comment
    // above; same #FF3B30-is-already-correct-in-light-mode reasoning.
    backgroundColor: "#FF3B30",
  },
  actionCol: {
    height: IOS_INPUT_MIN_HEIGHT,
    justifyContent: "center",
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
