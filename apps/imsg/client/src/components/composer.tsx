import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  type GestureResponderEvent,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
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
import { uploadAndSendAttachment } from "@/lib/attachment-upload";
import { setTyping as sendTyping } from "@/lib/presence-api";
import { messagingCommandError } from "@/lib/messaging-api";
import { sendWithSuggestionFeedback } from "@/lib/ai-api";
import { getDraft, setDraft } from "@/lib/drafts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatAddress } from "@shared/address";
import { registerFocusTarget, setListMode } from "@/lib/keyboard/controller";
import { onFillComposer, type SuggestionAttribution } from "@/lib/composer-fill";
import type { Contact, Message, Participant } from "@shared/types";
import type { MentionAnnotation } from "@shared/mentions";
import { mentionQueryAt, reconcileMentionAnnotations, trimMentionAnnotations } from "@shared/mentions";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { TriageGeometry } from "@/constants/triage-theme";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { HOVER_DIM, PRESS_DIM, Radii } from "@/constants/theme";
import {
  browserFilesToAttachments,
  filesFromTransfer,
  MAX_PENDING_ATTACHMENTS,
  mergePendingAttachments,
  releaseObjectUrl,
  type PendingAttachmentAsset,
} from "@/lib/attachments";
import { appleMapsLocationUrl, webLocationBlockReason } from "@/lib/message-actions";
import { burstGate } from "@/lib/burst-gate";
import { formatRecordingClock, type VoiceMemoEnd, voiceMemoOutcome } from "@/lib/voice-memo";
import { PersonAvatar } from "./avatar";
import { OverlayShell } from "./overlay-shell";
import { MorphSendButton, type SendStatus } from "./motion/morph-send-button";
import { ScheduleEditor } from "./schedule-editor";
import { SuggestionAlternates, type SuggestionSource, useReplySuggestions } from "./suggestion-shelf";
import { useSpring } from "@/constants/springs";

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
  /** Web: the pane that accepts dropped files into this composer. */
  dropTargetRef: RefObject<View | null>;
  onDragActiveChange: (active: boolean) => void;
  /** Reply suggestions: the top one is the field's ghost text, the rest are the alternates under it. */
  suggestions: SuggestionSource;
  /** The state strip, which sits directly on the field. */
  strip?: ReactNode;
}

interface PendingAttachment extends PendingAttachmentAsset {
  /** Present when this pending item is a contact card, sent via the server. */
  contact?: Contact;
}

/** One toast per burst of failed sends, shared across composers and chats. */
const sendFailureToast = burstGate(5_000);
/** Matches MorphSendButton's check hold. */
const SENT_HOLD_MS = 900;

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
// Six lines, as Messages.app, then the field scrolls.
const IOS_INPUT_MAX_HEIGHT = IOS_INPUT_LINE_HEIGHT * 6 + IOS_INPUT_CHROME_V;

// The desktop card's field: 14 over the text, and room under it so one line still reads as a
// roomy field (58 tall) before the toolbar.
const CARD_FONT = 14;
const CARD_LINE_HEIGHT = 20;
const CARD_PAD_TOP = 14;
const CARD_PAD_BOTTOM = 24;
const CARD_MIN_HEIGHT = CARD_PAD_TOP + CARD_LINE_HEIGHT + CARD_PAD_BOTTOM;
const CARD_MAX_HEIGHT = CARD_LINE_HEIGHT * 6 + CARD_PAD_TOP + CARD_PAD_BOTTOM;
/** Phone: room on the field's right for the Use key while the ghost shows. */
const USE_KEY_INSET = 64;

/**
 * The top reply suggestion, drawn in the empty field in tertiary ink. It fades on snappy as
 * typing starts and returns when the field empties; Reduce Motion makes it instant.
 */
function GhostText({ text, shown, card, fontSize, color, onHeight }: {
  text: string;
  shown: boolean;
  card: boolean;
  fontSize: number;
  color: string;
  onHeight: (height: number) => void;
}): React.JSX.Element {
  const spring = useSpring("snappy");
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withSpring(shown ? 1 : 0, spring);
  }, [opacity, shown, spring]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Reanimated.View pointerEvents="none" aria-hidden style={[card ? styles.cardGhost : styles.phoneGhost, fade]}>
      <Text
        testID="composer-ghost"
        onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
        style={{ color, fontSize, lineHeight: card ? CARD_LINE_HEIGHT : IOS_INPUT_LINE_HEIGHT }}
      >
        {text}
      </Text>
    </Reanimated.View>
  );
}


function tempMessage(
  chatGuid: string,
  text: string,
  replyTo: Message | null,
  mentions: readonly MentionAnnotation[],
): Message {
  const guid = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    guid,
    clientKey: guid,
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
  dropTargetRef,
  onDragActiveChange,
  suggestions,
  strip,
}: ComposerProps) {
  const theme = useTheme();
  const type = useType();
  // Wide: one rounded card on the gray thread. Phone keeps the iOS bar and pill field.
  const { wide: card } = useLayoutMode();
  const insets = useSafeAreaInsets();
  const showSheet = useActionSheet();
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [text, setText] = useState(() => getDraft(chatGuid));
  const [inputHeight, setInputHeight] = useState(IOS_INPUT_MIN_HEIGHT);
  const [selection, setSelection] = useState({ start: text.length, end: text.length });
  const [mentions, setMentions] = useState<MentionAnnotation[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const suggestionAttribution = useRef<SuggestionAttribution | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [customScheduleAt, setCustomScheduleAt] = useState(Date.now() + 3_600_000);
  const [scheduleAnchor, setScheduleAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const containerRef = useRef<View>(null);
  const isSMS = chatIsSMS(chatGuid);
  const loadRemoteDraft = useCallback((draft: string) => {
    setText(draft);
    setSelection({ start: draft.length, end: draft.length });
    setMentions([]);
    suggestionAttribution.current = null;
    setInputHeight(IOS_INPUT_MIN_HEIGHT);
  }, []);
  const draftSync = useComposerDraft(chatGuid, editing !== null, loadRemoteDraft);
  const replySuggestions = useReplySuggestions(chatGuid, suggestions);
  const ghost = replySuggestions.slots.kind === "ready" ? replySuggestions.slots.ghost : null;
  const [ghostTextHeight, setGhostHeight] = useState(0);

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
  // Drives the send button's arrow, ring and check. "sent" holds the check, then returns to idle.
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  useEffect(() => {
    if (sendStatus !== "sent") return;
    const timer = setTimeout(() => setSendStatus("idle"), SENT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [sendStatus]);
  const inputRef = useRef<TextInput>(null);
  const acceptMentionRef = useRef<() => boolean>(() => false);
  const acceptGhostRef = useRef<() => boolean>(() => false);
  const typingActive = useRef(false);
  const typingSentAt = useRef(0);
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
    suggestionAttribution.current = null;
    setInputHeight(IOS_INPUT_MIN_HEIGHT);
    for (const attachment of pendingRef.current) cleanupPendingAttachment(attachment);
    replacePending([]);
  }, [chatGuid, replacePending]);

  useEffect(() => {
    if (editing) {
      suggestionAttribution.current = null;
      setText(editing.text);
      setSelection({ start: editing.text.length, end: editing.text.length });
      setMentions([]);
    }
  }, [editing]);

  // Suggestion shelf drops text in here for editing; never auto-sends.
  useEffect(
    () =>
      onFillComposer((fill) => {
        setText(fill.text);
        setSelection({ start: fill.text.length, end: fill.text.length });
        setMentions([]);
        suggestionAttribution.current = fill.attribution;
        setDraft(chatGuid, fill.text);
        inputRef.current?.focus();
      }),
    [chatGuid],
  );

  // The composer is a focus target: desktop reply-intent selections and the empty lens's
  // Nudge request it (docs/keyboard-design.md). Type-anywhere is gone: it can't coexist with
  // glide-mode single keys, and its char-append was wrong for IME/dead-key/emoji input anyway.
  useEffect(() => registerFocusTarget("composer", () => inputRef.current?.focus()), [chatGuid]);

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
      if (event.key === "Tab" && !event.shiftKey && acceptGhostRef.current()) {
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
    const now = Date.now();
    if (typingActive.current === active && (!active || now - typingSentAt.current < 2500)) return;
    typingActive.current = active;
    typingSentAt.current = now;
    void sendTyping(chatGuid, active).catch(() => undefined);
  };

  const onChangeText = (value: string) => {
    setMentions((current) => reconcileMentionAnnotations(text, value, current));
    setText(value);
    if (value.trim().length === 0) suggestionAttribution.current = null;
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
    suggestionAttribution.current = null;
    setInputHeight(IOS_INPUT_MIN_HEIGHT);
  };

  // Desktop web growth: the DOM textarea reports scrollHeight reliably —
  // classic autosize, same 6-line cap as iOS. Runs after every text commit
  // (clears included), so it also shrinks back.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node || !node.style) return;
    // Reset to the one-line floor BEFORE measuring: scrollHeight never reports
    // less than the current height, and RNW's empty textarea is ~2 rows tall —
    // resetting to "auto" made that the permanent minimum.
    const [min, max] = card ? [CARD_MIN_HEIGHT, CARD_MAX_HEIGHT] : [IOS_INPUT_MIN_HEIGHT, IOS_INPUT_MAX_HEIGHT];
    node.style.height = `${min}px`;
    const next = Math.min(Math.max(node.scrollHeight, min), max);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
  }, [text, card]);

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
        showToast("Couldn't edit. Messages can only be edited for 15 minutes.");
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
      setSendStatus("sending");
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
        setSendStatus("sent");
        // No playSend() here — confirmation already fired on touch-up above.
      } catch (error) {
        setSendStatus("idle");
        hapticFailure();
        showToast(messagingCommandError(error, "Couldn't send the attachment. Check the Mac mini connection."));
      } finally {
        for (const attachment of attachments) cleanupPendingAttachment(attachment);
        setBusy(false);
      }
      return;
    }

    const attribution = suggestionAttribution.current;
    const temp = tempMessage(chatGuid, trimmed, replyTo, outgoingMentions);
    const reply = replyTo;
    clearText();
    setDraft(chatGuid, "");
    onClearReply();
    onOptimistic(temp);
    playSend();
    hapticSend();
    setSendStatus("sending");
    try {
      const message = await sendWithSuggestionFeedback(
        () => api.sendText(chatGuid, {
          text: trimmed,
          replyToGuid: reply?.guid,
          mentions: outgoingMentions.length > 0 ? outgoingMentions : undefined,
        }, { clientKey: temp.guid }),
        () => attribution
          ? api.recordSuggestionFeedback(chatGuid, { ...attribution, finalText: trimmed })
          : Promise.resolve(),
      );
      const withMentions =
        outgoingMentions.length > 0 && (message.mentions ?? []).length === 0
          ? { ...message, mentions: outgoingMentions }
          : message;
      // BlueBubbles can echo a freshly-sent SMS back as "iMessage" before it
      // reclassifies — pin the service so the green bubble never flashes blue.
      onSettled(temp.guid, isSMS ? { ...withMentions, service: "SMS" } : withMentions);
      setSendStatus("sent");
    } catch {
      setSendStatus("idle");
      hapticFailure();
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
      if (sendFailureToast()) showToast("Couldn't send. Check the Mac mini connection.");
    }
  };

  sendRef.current = () => void send();

  const uploadAsset = async (att: PendingAttachment, caption?: string) => {
    if (att.contact) {
      onSent(await api.sendContactCard(chatGuid, att.contact, caption));
      return;
    }
    onSent(await uploadAndSendAttachment(chatGuid, {
      uri: att.uri, filename: att.name, mimeType: att.mime,
      caption, isAudioMessage: false,
    }));
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
    const pane = dropTargetRef.current as never as HTMLElement | null;
    if (!node || !pane || typeof pane.addEventListener !== "function") return;
    let dragDepth = 0;

    const carriesFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes("Files") === true;
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
    // dragenter/dragleave fire for every child crossed, so only the depth
    // returning to zero means the pointer left the pane.
    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      dragDepth++;
      onDragActiveChange(true);
    };
    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) onDragActiveChange(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      onDragActiveChange(false);
      stageBrowserFiles(filesFromTransfer(event.dataTransfer));
    };

    node.addEventListener("paste", onPaste);
    pane.addEventListener("dragenter", onDragEnter);
    pane.addEventListener("dragover", onDragOver);
    pane.addEventListener("dragleave", onDragLeave);
    pane.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("paste", onPaste);
      pane.removeEventListener("dragenter", onDragEnter);
      pane.removeEventListener("dragover", onDragOver);
      pane.removeEventListener("dragleave", onDragLeave);
      pane.removeEventListener("drop", onDrop);
      onDragActiveChange(false);
    };
  }, [stage, dropTargetRef, onDragActiveChange]);

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
      showToast("Couldn't paste the image. Try copying it again.");
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
      showToast("Camera access is off. Allow it in Settings.");
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
  const sendBtnRef = useRef<View>(null);
  const scheduleBtnRef = useRef<View>(null);
  const serviceBtnRef = useRef<View>(null);
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
  // Native: hold to record, release sends, slide off cancels. Web: a click
  // toggles recording on, then explicit Send / Cancel buttons (or Esc) end it.
  const recordStartedAt = useRef<number | null>(null);
  const micHeld = useRef(false);

  const startRecording = async () => {
    if (recordStartedAt.current !== null) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        showToast("Microphone access is off. Allow it in Settings.");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartedAt.current = Date.now();
      // The hold ended while the permission prompt or prepare was in flight.
      if (Platform.OS !== "web" && !micHeld.current) void finishRecording("cancel");
    } catch {
      showToast("Couldn't start recording. Check microphone access.");
    }
  };

  const finishRecording = async (end: VoiceMemoEnd) => {
    const startedAt = recordStartedAt.current;
    if (startedAt === null) return;
    recordStartedAt.current = null;
    const outcome = voiceMemoOutcome(end, Date.now() - startedAt);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (outcome === "discard" || !uri) return;
      setBusy(true);
      playSend();
      hapticSend();
      onSent(await uploadAndSendAttachment(chatGuid, {
        uri, filename: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4", isAudioMessage: true,
      }));
    } catch (error) {
      hapticFailure();
      showToast(messagingCommandError(error, "Couldn't send the voice message. Check the Mac mini connection."));
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
            .catch(() => showToast("Couldn't schedule the message. Try again."));
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
    // Desktop: the menu opens upward from Send later; the date editor opens upward
    // from the send button, right edges aligned. Mobile keeps the centered sheet and dialog.
    const sendNode = sendBtnRef.current;
    const laterNode = scheduleBtnRef.current;
    if (Platform.OS === "web" && typeof window !== "undefined" && window.innerWidth >= 768 && sendNode && laterNode) {
      sendNode.measureInWindow((x, y, width) => {
        setScheduleAnchor({ right: window.innerWidth - (x + width), bottom: window.innerHeight - y + 8 });
        laterNode.measureInWindow((laterX, laterY) => showSheet({ title: "Send later", actions, anchor: { x: laterX, y: laterY } }));
      });
    } else {
      setScheduleAnchor(null);
      showSheet({ title: "Send later", actions });
    }
  };

  const recording = recorderState.isRecording;
  const finishRecordingRef = useRef(finishRecording);
  finishRecordingRef.current = finishRecording;

  // Esc cancels a take. Window capture runs before the app's document-level
  // dispatcher, so Escape here never also closes the thread.
  useEffect(() => {
    if (Platform.OS !== "web" || !recording || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void finishRecordingRef.current("cancel");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  const canSend = text.trim().length > 0 || pending.length > 0;
  const canSchedule = text.trim().length > 0 && pending.length === 0 && !editing;
  const sendColor = isSMS ? theme.sms : theme.bubbleMine;
  const serviceLabel = isSMS ? "SMS" : "iMessage";
  const ghostShown = ghost !== null && text.length === 0 && !editing && pending.length === 0 && !recording;
  const ghostPadV = card ? CARD_PAD_TOP + CARD_PAD_BOTTOM : IOS_INPUT_CHROME_V;
  const ghostHeight = Math.min(ghostTextHeight + ghostPadV, card ? CARD_MAX_HEIGHT : IOS_INPUT_MAX_HEIGHT);
  acceptGhostRef.current = (): boolean => {
    if (!ghostShown || !ghost) return false;
    replySuggestions.apply(ghost);
    return true;
  };

  // The conversation's service follows its chat: an SMS or RCS chat sends green. The outbox has no
  // per-message service yet, so the other service shows but cannot be picked.
  const openServiceMenu = () => {
    const other = isSMS ? "iMessage" : "SMS";
    const actions = [
      { label: serviceLabel, icon: "checkmark" as const, onPress: () => undefined },
      { label: other, disabled: true, note: "Switching services isn't available yet", onPress: () => undefined },
    ];
    if (Platform.OS === "web" && serviceBtnRef.current) {
      serviceBtnRef.current.measureInWindow((x, y) => showSheet({ title: "Send with", actions, anchor: { x, y } }));
    } else {
      showSheet({ title: "Send with", actions });
    }
  };

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

  const attachButton = (
    <Pressable
      ref={attachBtnRef}
      accessibilityRole="button"
      accessibilityLabel="Add attachment"
      onPress={openAttachSheet}
      disabled={busy || recording}
      hitSlop={8}
      style={({ hovered, pressed }) => card
        ? [styles.toolIcon, (hovered || pressed) && { backgroundColor: theme.rowHover }]
        : [styles.sendButton, { backgroundColor: hovered || pressed ? theme.backgroundSelected : theme.field }, pressed && { opacity: HOVER_DIM }]}
    >
      {({ hovered, pressed }) => <Ionicons name="add" size={card ? 19 : 22} color={hovered || pressed ? theme.text : theme.icon} />}
    </Pressable>
  );

  // Stays up after a send clears the field, so the ring and check have somewhere to play.
  const sendControl = (canSend || sendStatus !== "idle") && !recording ? (
    <View ref={sendBtnRef}>
      {/* New text brings the arrow straight back, so a second send never waits on the first. */}
      <MorphSendButton status={canSend ? "idle" : sendStatus} disabled={busy && sendStatus === "idle"} onPress={() => void send()} color={sendColor} />
    </View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? "Send voice message" : "Record voice message"}
      {...(Platform.OS === "web"
        ? {
            onPress: () => void (recording ? finishRecording("send") : startRecording()),
          }
        : {
            onPressIn: () => {
              micHeld.current = true;
              void startRecording();
            },
            // RN Pressable fires onPressOut on release AND when the finger
            // slides off the hit rect; only a release inside it sends.
            onPressOut: (event: GestureResponderEvent) => {
              micHeld.current = false;
              const { locationX, locationY } = event.nativeEvent;
              const inside = locationX >= -24 && locationX <= 58 && locationY >= -24 && locationY <= 58;
              void finishRecording(inside ? "send" : "cancel");
            },
          })}
      hitSlop={8}
      disabled={busy || Boolean(editing)}
      style={({ hovered, pressed }) => [
        styles.sendButton,
        { backgroundColor: recording ? theme.destructive : theme.field },
        !recording && (hovered || pressed) && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Ionicons
        name={recording ? (Platform.OS === "web" ? "arrow-up" : "stop") : "mic"}
        size={19}
        color={recording ? theme.onAccent : theme.icon}
      />
    </Pressable>
  );

  const field = recording ? (
    <View style={[styles.input, styles.recordingBar, card && styles.cardRecording, { borderColor: theme.divider }]}>
      <View style={[styles.recDot, { backgroundColor: theme.destructive }]} />
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: theme.text, fontSize: 15, fontVariant: ["tabular-nums"], flex: 1 }}
      >
        {formatRecordingClock(recorderState.durationMillis ?? 0)}
      </Text>
      {Platform.OS === "web" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel recording"
          onPress={() => void finishRecording("cancel")}
          style={({ hovered, pressed }) => [styles.recCancel, (hovered || pressed) && { backgroundColor: theme.backgroundElement }]}
        >
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Cancel · Esc</Text>
        </Pressable>
      ) : (
        <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Slide away to cancel</Text>
      )}
    </View>
  ) : (
    <View style={card ? undefined : styles.phoneField}>
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
        onFocus={() => { setListMode(false); draftSync.onFocus(); }}
        onBlur={draftSync.onBlur}
        onChangeText={onChangeText}
        placeholder={editing ? "Edit message" : pending.length > 0 ? "Add a comment or Send" : isSMS ? "Text Message" : "iMessage"}
        // The ghost suggestion takes the placeholder's place; the attribute stays for assistive tech.
        placeholderTextColor={ghostShown ? "transparent" : theme.textSecondary}
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
          { color: theme.text, borderColor: theme.dividerStrong, backgroundColor: theme.surface, fontSize: type.body },
          card && [styles.cardInput, { backgroundColor: "transparent" }],
          ghostShown && { minHeight: ghostHeight, paddingRight: card ? styles.cardInput.paddingHorizontal : USE_KEY_INSET },
        ]}
      />
      {ghost && (
        <GhostText
          text={ghost.text}
          shown={ghostShown}
          card={card}
          fontSize={card ? CARD_FONT : type.body}
          color={theme.textTertiary}
          onHeight={setGhostHeight}
        />
      )}
      {!card && ghostShown && ghost && (
        <Pressable
          testID="composer-use-ghost"
          accessibilityRole="button"
          accessibilityLabel={`Use suggestion: ${ghost.text}`}
          onPress={() => replySuggestions.apply(ghost)}
          hitSlop={6}
          style={({ pressed }) => [styles.useKey, { borderColor: theme.dividerStrong }, pressed && { backgroundColor: theme.rowSelected }]}
        >
          <Text style={[styles.useKeyText, { color: theme.textSecondary }]}>Use</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View
      ref={containerRef}
      style={[
        styles.container,
        card && styles.cardHost,
        {
          // The strip sits on the field, so no rule crosses under it.
          borderTopColor: card || strip ? "transparent" : theme.divider,
          // Keep native controls clear of the keyboard and rounded display
          // edges — see barPadV above for why both edges share one value.
          paddingTop: barPadV,
          paddingBottom: card ? 22 : barPadV,
          paddingHorizontal: card ? 32 : Platform.OS === "web" ? 18 : keyboardUp ? 16 : 20,
        },
      ]}
    >
      <ScheduleEditor
        visible={customScheduleOpen}
        title="Choose Date & Time"
        initialText={text.trim()}
        initialSendAt={customScheduleAt}
        textEditable={false}
        anchor={scheduleAnchor}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear reply"
            onPress={onClearReply}
            hitSlop={8}
            style={({ hovered, pressed }) => [styles.bannerClear, hovered && !pressed && { backgroundColor: theme.backgroundSelected }, pressed && { backgroundColor: theme.backgroundSelected, opacity: HOVER_DIM }]}
          >
            {({ hovered, pressed }) => <Text style={{ color: hovered || pressed ? theme.text : theme.textSecondary }}>✕</Text>}
          </Pressable>
        </View>
      )}
      {editing && (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <Text numberOfLines={1} style={[styles.bannerText, { color: theme.text, fontWeight: "600" }]}>
            Editing message
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            onPress={() => {
              clearText();
              onClearEditing();
            }}
            hitSlop={8}
            style={({ hovered, pressed }) => [styles.bannerClear, hovered && !pressed && { backgroundColor: theme.backgroundSelected }, pressed && { backgroundColor: theme.backgroundSelected, opacity: HOVER_DIM }]}
          >
            {({ hovered, pressed }) => <Text style={{ color: hovered || pressed ? theme.text : theme.textSecondary }}>✕</Text>}
          </Pressable>
        </View>
      )}
      {activeMentionQuery && mentionSuggestions.length > 0 && (
        <View style={[styles.mentionList, { backgroundColor: theme.background, borderColor: theme.divider }]}>
          {mentionSuggestions.map((participant) => (
            <Pressable
              key={participant.address}
              onPress={() => selectMention(participant)}
              style={({ hovered, pressed }) => [styles.mentionRow, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
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
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                onPress={() => removePending(i)}
                style={({ hovered, pressed }) => [styles.pendingRemove, hovered && !pressed && { opacity: HOVER_DIM }, pressed && { opacity: PRESS_DIM }]}
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
      {strip && <View style={card ? styles.deskStrip : styles.phoneStrip}>{strip}</View>}
      {card ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
          {field}
          <View style={styles.tools}>
            {attachButton}
            <Pressable
              ref={serviceBtnRef}
              testID="composer-service"
              accessibilityRole="button"
              accessibilityLabel={`Service: ${serviceLabel}`}
              onPress={openServiceMenu}
              style={({ hovered, pressed }) => [styles.toolChip, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
            >
              <View style={[styles.serviceDot, { backgroundColor: sendColor }]} />
              <Text style={[styles.toolText, { color: theme.textSecondary }]}>{serviceLabel}</Text>
              <Ionicons name="chevron-down" size={13} color={theme.icon} />
            </Pressable>
            <View style={[styles.toolSep, { backgroundColor: theme.divider }]} />
            <Pressable
              ref={scheduleBtnRef}
              accessibilityRole="button"
              accessibilityLabel="Send later"
              accessibilityState={{ disabled: !canSchedule || busy || recording }}
              onPress={openScheduleSheet}
              disabled={!canSchedule || busy || recording}
              style={({ hovered, pressed }) => [styles.toolChip, { opacity: canSchedule ? 1 : 0.5 }, canSchedule && (hovered || pressed) && { backgroundColor: theme.rowHover }]}
            >
              <Ionicons name="time-outline" size={15} color={theme.icon} />
              <Text style={[styles.toolText, { color: theme.textSecondary }]}>Send later</Text>
            </Pressable>
            <View style={styles.toolSpacer} />
            {ghostShown && (
              <View testID="composer-tab-hint" style={styles.tabHint}>
                <Text style={[styles.kbd, { borderColor: theme.dividerStrong, color: theme.textSecondary }]}>Tab</Text>
                <Text style={[styles.tabHintText, { color: theme.textTertiary }]}>accept</Text>
              </View>
            )}
            {sendControl}
          </View>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <View style={styles.actionCol}>{attachButton}</View>
          {field}
          <View style={styles.actionCol}>
            {canSchedule && !recording && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send later"
                onPress={openScheduleSheet}
                disabled={busy}
                hitSlop={6}
                style={({ hovered, pressed }) => [styles.scheduleCaret, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
              >
                {({ hovered, pressed }) => <Ionicons name="chevron-up" size={18} color={hovered || pressed ? theme.text : theme.textSecondary} />}
              </Pressable>
            )}
            {sendControl}
          </View>
        </View>
      )}
      <SuggestionAlternates state={replySuggestions} wide={card} />
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
  bannerClear: { borderRadius: 6, margin: -3, padding: 3 },
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
  // StateStrip insets itself 32; these pull it onto the field. Desktop: 14 inside the card.
  // Phone: from 14 inside the field's left curve to 26 short of the screen edge.
  deskStrip: { marginHorizontal: 14 - 32 },
  phoneStrip: { marginLeft: 34 + 8 + 14 - 32, marginRight: 26 - 18 - 32 },
  phoneField: { flex: 1 },
  tools: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingBottom: 8,
    paddingHorizontal: 8,
    paddingTop: 2,
  },
  toolIcon: { alignItems: "center", borderRadius: 7, height: 30, justifyContent: "center", width: 30 },
  toolChip: { alignItems: "center", borderRadius: 7, flexDirection: "row", gap: 6, height: 28, paddingHorizontal: 8 },
  toolText: { fontSize: 12.5, fontWeight: "500" },
  toolSep: { height: 16, marginHorizontal: 2, width: 1 },
  toolSpacer: { flex: 1 },
  serviceDot: { borderRadius: 4, height: 8, width: 8 },
  tabHint: { alignItems: "center", flexDirection: "row", gap: 6, marginRight: 6 },
  kbd: { borderRadius: 5, borderWidth: 1, fontSize: 11, fontWeight: "600", paddingHorizontal: 5, paddingVertical: 1 },
  tabHintText: { fontSize: 12 },
  cardGhost: { left: 16, position: "absolute", right: 16, top: CARD_PAD_TOP },
  phoneGhost: { left: MIRROR_INSET_H, position: "absolute", right: USE_KEY_INSET, top: (Platform.OS === "web" ? 7 : 8) + INPUT_BORDER_W },
  useKey: {
    borderRadius: 6,
    borderWidth: 1,
    bottom: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    position: "absolute",
    right: 10,
  },
  useKeyText: { fontSize: 12, fontWeight: "600" },
  cardRecording: { borderWidth: 0, marginHorizontal: 8, marginTop: 8 },
  cardHost: {
    alignSelf: "center",
    borderTopWidth: 0,
    maxWidth: TriageGeometry.threadMaxWidth + 64,
    width: "100%",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
  },
  cardInput: {
    borderWidth: 0,
    fontSize: CARD_FONT,
    lineHeight: CARD_LINE_HEIGHT,
    minHeight: CARD_MIN_HEIGHT,
    paddingBottom: CARD_PAD_BOTTOM,
    paddingHorizontal: 16,
    paddingTop: CARD_PAD_TOP,
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
    flex: 1,
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
  recCancel: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
    borderRadius: 7,
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
