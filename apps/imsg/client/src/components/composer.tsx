import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { cacheDirectory, deleteAsync, EncodingType, writeAsStringAsync } from "expo-file-system/legacy";
import * as Location from "expo-location";
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { showToast } from "@/lib/toast";
import { hapticFailure, hapticSend } from "@/lib/haptics";
import { playSend } from "@/lib/sounds";
import { useActionSheet } from "@/lib/action-sheet";
import { api } from "@/lib/api";
import { chatIsSMS } from "@/lib/chat-service";
import { INPUT_BORDER_W, INPUT_PADDING_H, MIRROR_INSET_H } from "@/lib/composer-metrics";
import { BASE_URL } from "@/lib/config";
import { getDraft, setDraft } from "@/lib/drafts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatAddress } from "@shared/address";
import { registerFocusTarget, setListMode } from "@/lib/keyboard/controller";
import { onFillComposer } from "@/lib/composer-fill";
import type { Contact, Message, Participant } from "@shared/types";
import type { MentionAnnotation } from "@shared/mentions";
import { mentionQueryAt, reconcileMentionAnnotations, trimMentionAnnotations } from "@shared/mentions";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { Radii } from "@/constants/theme";
import {
  browserFilesToAttachments,
  MAX_PENDING_ATTACHMENTS,
  mergePendingAttachments,
  releaseObjectUrl,
  type PendingAttachmentAsset,
} from "@/lib/attachments";
import { appleMapsLocationUrl, webLocationBlockReason } from "@/lib/message-actions";
import { PersonAvatar } from "./avatar";
import { OverlayShell } from "./overlay-shell";
import { ScheduleEditor } from "./schedule-editor";

interface ComposerProps {
  chatGuid: string;
  isGroup: boolean;
  participants: Participant[];
  privateApi: boolean;
  replyTo: Message | null;
  editing: Message | null;
  onClearReply: () => void;
  onClearEditing: () => void;
  onEdited: (message: Message) => void;
  onOptimistic: (message: Message) => void;
  onSettled: (tempGuid: string, message: Message) => void;
  onSent: (message: Message) => void;
}

interface PendingAttachment extends PendingAttachmentAsset {
  /** Present when this pending item is a contact card, sent via the server. */
  contact?: Contact;
}

const IOS_INPUT_LINE_HEIGHT = 22;
/**
 * Everything the input's `height` has to cover BESIDES the text itself.
 *
 * React Native sizes with the border box, so the usable text area is
 * `height − padding − border`. This constant previously counted only the
 * padding (8 + 8), which left the text area 2px shorter than the measured
 * text every time — the last line was always slightly clipped, and combined
 * with the mirror's width being off it read as "the line I'm typing is
 * invisible until I start the next one". Derived from the same metrics the
 * input's own style uses so the two can't drift.
 */
const IOS_INPUT_CHROME_V = 8 + 8 + INPUT_BORDER_W * 2;
const IOS_INPUT_MIN_HEIGHT = IOS_INPUT_LINE_HEIGHT + IOS_INPUT_CHROME_V;
const IOS_INPUT_MAX_HEIGHT = IOS_INPUT_LINE_HEIGHT * 10 + IOS_INPUT_CHROME_V;


function tempMessage(
  chatGuid: string,
  text: string,
  replyTo: Message | null,
  mentions: readonly MentionAnnotation[],
): Message {
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
    mentions: [...mentions],
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

function cleanupPendingAttachment(attachment: PendingAttachment): void {
  if (
    typeof URL !== "undefined" &&
    releaseObjectUrl(attachment, (uri) => URL.revokeObjectURL(uri))
  ) {
    return;
  }
  if (attachment.cleanup === "cache-file") {
    void deleteAsync(attachment.uri, { idempotent: true }).catch(() => undefined);
  }
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
    <OverlayShell
      visible={visible}
      onClose={onClose}
      backdropStyle={pickerStyles.backdrop}
      cardStyle={[pickerStyles.card, { borderColor: theme.divider }]}
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
            <PersonAvatar address={item.address} name={item.name || item.address} size={32} />
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
    </OverlayShell>
  );
}

export function Composer({
  chatGuid,
  isGroup,
  participants,
  privateApi,
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
  const type = useType();
  const insets = useSafeAreaInsets();
  const showSheet = useActionSheet();
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [text, setText] = useState(() => getDraft(chatGuid));
  const [inputHeight, setInputHeight] = useState(IOS_INPUT_MIN_HEIGHT);
  const [selection, setSelection] = useState({ start: text.length, end: text.length });
  const [mentions, setMentions] = useState<MentionAnnotation[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [customScheduleAt, setCustomScheduleAt] = useState(Date.now() + 3_600_000);
  const [dragActive, setDragActive] = useState(false);
  const containerRef = useRef<View>(null);
  const isSMS = chatIsSMS(chatGuid);

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
  const acceptMentionRef = useRef<() => boolean>(() => false);
  const typingActive = useRef(false);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const replacePending = useCallback((next: PendingAttachment[]): void => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  useEffect(
    () => () => {
      for (const attachment of pendingRef.current) cleanupPendingAttachment(attachment);
    },
    [],
  );

  // Swap drafts when the conversation changes.
  useEffect(() => {
    const draft = getDraft(chatGuid);
    setText(draft);
    setSelection({ start: draft.length, end: draft.length });
    setMentions([]);
    setInputHeight(IOS_INPUT_MIN_HEIGHT);
    for (const attachment of pendingRef.current) cleanupPendingAttachment(attachment);
    replacePending([]);
  }, [chatGuid, replacePending]);

  useEffect(() => {
    if (editing) {
      setText(editing.text);
      setSelection({ start: editing.text.length, end: editing.text.length });
      setMentions([]);
    }
  }, [editing]);

  // Suggestion shelf drops text in here for editing; never auto-sends.
  useEffect(
    () =>
      onFillComposer((suggestion) => {
        setText(suggestion);
        setSelection({ start: suggestion.length, end: suggestion.length });
        setMentions([]);
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
      if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && acceptMentionRef.current()) {
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        // Deliberately NOT gated on an in-flight send: each send gets its own
        // optimistic temp message and resolves independently, so waiting for
        // the previous round-trip only made a fast typist's second message
        // silently vanish. Double-fire on one message is already impossible —
        // send() clears the input synchronously before awaiting, so a repeat
        // Enter finds empty text and returns.
        if (event.isComposing || event.repeat) return;
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
    setMentions((current) => reconcileMentionAnnotations(text, value, current));
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
      Math.max(Math.ceil(height) + IOS_INPUT_CHROME_V, IOS_INPUT_MIN_HEIGHT),
      IOS_INPUT_MAX_HEIGHT,
    );
    setInputHeight((current) => (current === next ? current : next));
  };

  /** Programmatic clear (send/schedule/edit-cancel): text + growth reset together. */
  const clearText = () => {
    setText("");
    setSelection({ start: 0, end: 0 });
    setMentions([]);
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
    const outgoing = trimMentionAnnotations(text, mentions);
    const trimmed = outgoing.text;
    const outgoingMentions = isGroup && privateApi && !isSMS ? outgoing.mentions : [];
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

    // Send staged attachments first (plain text rides the first one as a
    // caption). A real mention stays a separate attributed text message because
    // BlueBubbles' attachment subject field cannot carry mention runs.
    if (pending.length > 0) {
      const attachments = pending;
      const caption = outgoingMentions.length === 0 ? trimmed || undefined : undefined;
      replacePending([]);
      clearText();
      setDraft(chatGuid, "");
      setBusy(true);
      // Confirm on touch-up, not on upload completion — Apple plays the whoosh
      // when you commit, and a confirmation that waits on the network reads as lag.
      playSend();
      hapticSend();
      try {
        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          if (attachment) await uploadAsset(attachment, i === 0 ? caption : undefined);
        }
        if (trimmed && outgoingMentions.length > 0) {
          const mentionMessage = await api.sendText(chatGuid, {
            text: trimmed,
            replyToGuid: replyTo?.guid,
            mentions: outgoingMentions,
          });
          onSent(
            (mentionMessage.mentions ?? []).length > 0
              ? mentionMessage
              : { ...mentionMessage, mentions: outgoingMentions },
          );
        }
        onClearReply();
        // No playSend() here — confirmation already fired on touch-up above.
      } catch {
        hapticFailure();
        showToast("Attachment failed");
      } finally {
        for (const attachment of attachments) cleanupPendingAttachment(attachment);
        setBusy(false);
      }
      return;
    }

    const temp = tempMessage(chatGuid, trimmed, replyTo, outgoingMentions);
    const reply = replyTo;
    clearText();
    setDraft(chatGuid, "");
    onClearReply();
    onOptimistic(temp);
    playSend();
    hapticSend();
    try {
      const message = await api.sendText(chatGuid, {
        text: trimmed,
        replyToGuid: reply?.guid,
        mentions: outgoingMentions.length > 0 ? outgoingMentions : undefined,
      });
      const withMentions =
        outgoingMentions.length > 0 && (message.mentions ?? []).length === 0
          ? { ...message, mentions: outgoingMentions }
          : message;
      // BlueBubbles can echo a freshly-sent SMS back as "iMessage" before it
      // reclassifies — pin the service so the green bubble never flashes blue.
      onSettled(temp.guid, isSMS ? { ...withMentions, service: "SMS" } : withMentions);
    } catch {
      hapticFailure();
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
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
  const stage = useCallback(
    (assets: PendingAttachment[]): void => {
      if (assets.length === 0) return;
      const merged = mergePendingAttachments(pendingRef.current, assets);
      for (const rejected of merged.rejected) cleanupPendingAttachment(rejected);
      if (merged.rejected.length > 0) showToast(`You can attach up to ${MAX_PENDING_ATTACHMENTS} items`);
      replacePending(merged.items);
    },
    [replacePending],
  );

  const removePending = (index: number): void => {
    const removed = pendingRef.current[index];
    if (removed) cleanupPendingAttachment(removed);
    const next = pendingRef.current.filter((_, itemIndex) => itemIndex !== index);
    replacePending(next);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = containerRef.current as never as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    let dragDepth = 0;

    const filesFromTransfer = (transfer: DataTransfer | null): File[] => {
      if (!transfer) return [];
      const direct = Array.from(transfer.files);
      if (direct.length > 0) return direct;
      return Array.from(transfer.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
    };
    const stageBrowserFiles = (files: File[]): void => {
      if (files.length === 0) return;
      stage(browserFilesToAttachments(files, (file) => URL.createObjectURL(file)));
    };
    const onPaste = (event: ClipboardEvent): void => {
      const files = filesFromTransfer(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      stageBrowserFiles(files);
    };
    const onDragEnter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      dragDepth++;
      setDragActive(true);
    };
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDragLeave = (): void => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragActive(false);
    };
    const onDrop = (event: DragEvent): void => {
      const files = filesFromTransfer(event.dataTransfer);
      dragDepth = 0;
      setDragActive(false);
      if (files.length === 0) return;
      event.preventDefault();
      stageBrowserFiles(files);
    };

    node.addEventListener("paste", onPaste);
    node.addEventListener("dragenter", onDragEnter);
    node.addEventListener("dragover", onDragOver);
    node.addEventListener("dragleave", onDragLeave);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("paste", onPaste);
      node.removeEventListener("dragenter", onDragEnter);
      node.removeEventListener("dragover", onDragOver);
      node.removeEventListener("dragleave", onDragLeave);
      node.removeEventListener("drop", onDrop);
    };
  }, [stage]);

  const pasteNativeImage = async (): Promise<void> => {
    try {
      const image = await Clipboard.getImageAsync({ format: "png" });
      if (!image) {
        showToast("The clipboard doesn't contain an image");
        return;
      }
      if (!cacheDirectory) throw new Error("Expo cache directory is unavailable");
      const separator = image.data.indexOf(",");
      if (separator < 0) throw new Error("Clipboard image data is malformed");
      const filename = `clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
      const uri = `${cacheDirectory}${filename}`;
      await writeAsStringAsync(uri, image.data.slice(separator + 1), { encoding: EncodingType.Base64 });
      stage([
        {
          uri,
          name: filename,
          mime: "image/png",
          isImage: true,
          cleanup: "cache-file",
        },
      ]);
    } catch {
      showToast("Couldn't paste the clipboard image");
    }
  };

  const addCurrentLocation = async (): Promise<void> => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const blocked = webLocationBlockReason(window.isSecureContext, window.location.hostname);
      if (blocked) {
        showToast(blocked);
        return;
      }
    }
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        showToast("Location permission was denied. Enable foreground access in Settings and try again.");
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const url = appleMapsLocationUrl(location.coords.latitude, location.coords.longitude);
      const next = text.trim().length > 0 ? `${text.trimEnd()}
${url}` : url;
      onChangeText(next);
      setSelection({ start: next.length, end: next.length });
      showToast("Current location added");
    } catch {
      showToast(
        Platform.OS === "web"
          ? "Couldn't get location. Use the HTTPS tailnet address and allow browser location access."
          : "Couldn't get the current location. Check Location Services and foreground permission.",
      );
    }
  };

  const activeMentionQuery = useMemo(
    () =>
      isGroup && selection.start === selection.end ? mentionQueryAt(text, selection.start) : null,
    [isGroup, selection, text],
  );
  const mentionSuggestions = useMemo(() => {
    if (!activeMentionQuery) return [];
    const query = activeMentionQuery.query.toLowerCase();
    return participants
      .filter((participant) => {
        const label = participant.name ?? formatAddress(participant.address);
        return !query || label.toLowerCase().includes(query) || participant.address.toLowerCase().includes(query);
      })
      .slice(0, 5);
  }, [activeMentionQuery, participants]);

  const selectMention = (participant: Participant): void => {
    if (!activeMentionQuery) return;
    const label = participant.name?.trim() || formatAddress(participant.address);
    const trailing = text.slice(activeMentionQuery.end).startsWith(" ") ? "" : " ";
    const replacement = `${label}${trailing}`;
    const next = `${text.slice(0, activeMentionQuery.start)}${replacement}${text.slice(activeMentionQuery.end)}`;
    const reconciled = reconcileMentionAnnotations(text, next, mentions);
    const annotation: MentionAnnotation = {
      start: activeMentionQuery.start,
      length: label.length,
      address: participant.address,
    };
    setText(next);
    setMentions([...reconciled, annotation].sort((a, b) => a.start - b.start));
    setDraft(chatGuid, next);
    const cursor = activeMentionQuery.start + replacement.length;
    setSelection({ start: cursor, end: cursor });
    inputRef.current?.focus();
  };
  acceptMentionRef.current = (): boolean => {
    const first = mentionSuggestions[0];
    if (!first) return false;
    selectMention(first);
    return true;
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
        cleanup: null,
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
        cleanup: null,
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
        cleanup: null,
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
        cleanup: null,
        contact,
      },
    ]);
  };

  const attachBtnRef = useRef<View>(null);
  const scheduleBtnRef = useRef<View>(null);
  const openAttachSheet = () => {
    const actions = [{ label: "Photo or Video Library", onPress: () => void pickPhotos() }];
    if (Platform.OS !== "web") {
      actions.unshift({ label: "Take Photo or Video", onPress: () => void takePhoto() });
      actions.push({ label: "Paste Image", onPress: () => void pasteNativeImage() });
    }
    actions.push({ label: "Current Location", onPress: () => void addCurrentLocation() });
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
      playSend();
      hapticSend();
      const res = await fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/attachment`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        onSent((await res.json()) as Message);
      } else {
        hapticFailure();
        showToast("Voice message failed");
      }
    } catch {
      hapticFailure();
      showToast("Voice message failed");
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------- scheduled send
  const openScheduleSheet = () => {
    const trimmed = text.trim();
    if (!trimmed || pending.length > 0) return;
    const actions = [
      ...scheduleOptions().map((option) => ({
        label: option.label,
        onPress: () => {
          void api
            .schedule(chatGuid, trimmed, option.at)
            .then(() => {
              clearText();
              setDraft(chatGuid, "");
              showToast(`Scheduled ${option.label.toLowerCase()}`);
            })
            .catch(() => showToast("Couldn't schedule"));
        },
      })),
      {
        label: "Choose Date & Time…",
        onPress: () => {
          setCustomScheduleAt(Date.now() + 3_600_000);
          setCustomScheduleOpen(true);
        },
      },
    ];
    // Desktop: anchor the popover to the schedule caret (opens upward); mobile
    // keeps the centered sheet — same split the attachment menu above uses.
    if (Platform.OS === "web" && typeof window !== "undefined" && window.innerWidth >= 768 && scheduleBtnRef.current) {
      scheduleBtnRef.current.measureInWindow((x, y) => showSheet({ title: "Send later", actions, anchor: { x, y } }));
    } else {
      showSheet({ title: "Send later", actions });
    }
  };

  const recording = recorderState.isRecording;
  const canSend = text.trim().length > 0 || pending.length > 0;
  const canSchedule = text.trim().length > 0 && pending.length === 0 && !editing;
  const sendColor = isSMS ? theme.sms : theme.bubbleMine;

  // Keyboard down, the bar extends into the home-indicator strip and the
  // indicator simply draws over it — the same thing Messages does. Reserving
  // the WHOLE safe-area inset below the controls (an earlier attempt) just
  // recreated the dead gap it was meant to fix: the bar and the thread share a
  // background, so "extending the background" and "leaving a gap" look
  // identical, and all that registers is how far the field sits from the
  // bottom. Keep a modest clearance so the controls stay off the indicator
  // without floating above it. Keyboard up, the keyboard covers the strip.
  //
  // The SAME value pads the top, so the field is optically centered in its own
  // bar: the gap from the field down to the screen edge matches the gap from
  // the field up to the divider. An asymmetric bar reads as a layout bug even
  // when each edge is individually defensible.
  const barPadV =
    keyboardUp || Platform.OS === "web" ? 8 : 8 + Math.min(insets.bottom, 12);

  return (
    <View
      ref={containerRef}
      style={[
        styles.container,
        dragActive && styles.dropActive,
        dragActive && { borderColor: theme.accent, backgroundColor: theme.backgroundElement },
        {
          borderTopColor: theme.divider,
          // Keep native controls clear of the keyboard and rounded display
          // edges — see barPadV above for why both edges share one value.
          paddingTop: barPadV,
          paddingBottom: barPadV,
          paddingHorizontal: Platform.OS === "web" ? 18 : keyboardUp ? 16 : 20,
        },
      ]}
    >
      <ScheduleEditor
        visible={customScheduleOpen}
        title="Choose Date & Time"
        initialText={text.trim()}
        initialSendAt={customScheduleAt}
        textEditable={false}
        onClose={() => setCustomScheduleOpen(false)}
        onSubmit={async (scheduledText, sendAt) => {
          await api.schedule(chatGuid, scheduledText, sendAt);
          clearText();
          setDraft(chatGuid, "");
          showToast("Message scheduled");
        }}
      />
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
      {activeMentionQuery && mentionSuggestions.length > 0 && (
        <View style={[styles.mentionList, { backgroundColor: theme.background, borderColor: theme.divider }]}>
          {mentionSuggestions.map((participant) => (
            <Pressable
              key={participant.address}
              onPress={() => selectMention(participant)}
              style={({ pressed }) => [styles.mentionRow, pressed && { backgroundColor: theme.backgroundElement }]}
            >
              <PersonAvatar
                address={participant.address}
                name={participant.name ?? participant.address}
                size={28}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>
                  {participant.name ?? formatAddress(participant.address)}
                </Text>
                <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 11 }}>
                  {formatAddress(participant.address)}
                </Text>
              </View>
            </Pressable>
          ))}
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
                onPress={() => removePending(i)}
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
              selection={selection}
              onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
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
                Platform.OS === "web" && styles.webInput,
                { color: theme.text, borderColor: theme.divider, backgroundColor: theme.background, fontSize: type.body },
              ]}
            />
          </View>
        )}
        <View style={styles.actionCol}>
          {canSchedule && !recording && (
            <Pressable
              ref={scheduleBtnRef}
              accessibilityRole="button"
              accessibilityLabel="Schedule message"
              onPress={openScheduleSheet}
              disabled={busy}
              hitSlop={6}
              style={({ pressed }) => [styles.scheduleCaret, pressed && { opacity: 0.5 }]}
            >
              <Ionicons name="chevron-up" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
          {canSend && !recording ? (
            <Pressable
              onPress={() => void send()}
              onLongPress={canSchedule ? openScheduleSheet : undefined}
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
  // OverlayShell's backdrop already centers + scrims (its default color
  // equals Colors.light.backdrop, the value this used to hardcode) — only
  // the extra padding is site-specific.
  backdrop: {
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
});

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    // Vertical padding is set inline (barPadV) — it depends on keyboard state
    // and the safe-area inset, so static values here would only ever be dead
    // props that contradict what actually renders.
  },
  dropActive: {
    borderWidth: 2,
    borderTopWidth: 2,
  },
  mentionList: {
    borderRadius: Radii.input,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
    maxHeight: 220,
    overflow: "hidden",
  },
  mentionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
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
    // Same metrics as the input's TEXT AREA — inset by padding + border, not
    // padding alone, or it wraps at a different width than the input and
    // under-reports the line count (see lib/composer-metrics.ts).
    fontSize: 17,
    left: MIRROR_INSET_H,
    lineHeight: IOS_INPUT_LINE_HEIGHT,
    opacity: 0,
    pointerEvents: "none",
    position: "absolute",
    right: MIRROR_INSET_H,
    top: 0,
  },
  input: {
    borderWidth: INPUT_BORDER_W,
    borderRadius: 19,
    paddingHorizontal: INPUT_PADDING_H,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 17,
  },
  webInput: {
    lineHeight: 22,
    minHeight: 38,
    paddingBottom: 7,
    paddingTop: 7,
    textAlignVertical: "center",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: IOS_INPUT_MIN_HEIGHT,
  },
  scheduleCaret: {
    width: 28,
    height: 34,
    alignItems: "center",
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
