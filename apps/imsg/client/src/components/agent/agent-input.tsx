import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";

import { Dropdown, type DropdownOption } from "@/components/ui/dropdown";
import { IconButton } from "@/components/ui/icon-button";
import { HOVER_DIM, PRESS_DIM } from "@/constants/interaction";
import { Radius, Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import type { AgentEffort } from "@/lib/agent-api";
import { AGENT_EFFORTS, AGENT_MODELS, withModel, type AgentModel, type AgentModelChoice } from "@/lib/agent-models";
import { stepPromptHistory, type HistoryCursor } from "@/lib/agent-transcript";
import { useActionSheet } from "@/lib/action-sheet";
import { AGENT_ATTACHMENT_LIMIT, filesFromTransfer, MAX_PENDING_ATTACHMENTS, mergePendingAttachments, splitOversized, type PendingAttachmentAsset } from "@/lib/attachments";
import { registerFocusTarget, setListMode } from "@/lib/keyboard/controller";
import { showToast } from "@/lib/toast";

import { downscalableImageMimeType, fitImageAttachmentSize } from "./vendor/image-attachment-size";
import { nextPastedTextFileName, pastedTextDisposition } from "./vendor/text-paste";

/** A file staged in the pane input. Web pastes and drops carry their bytes; picked files a URI. */
export type StagedAttachment = PendingAttachmentAsset & { readonly blob?: Blob };

/** `alternate` is Option+Enter, T3's "the other dispatch" while a turn runs. */
export type SendIntent = { readonly text: string; readonly alternate: boolean; readonly attachments: readonly StagedAttachment[] };

const NO_RECALL: HistoryCursor = { index: null, draft: "" };
const MODEL_OPTIONS: readonly DropdownOption<AgentModel>[] = AGENT_MODELS.map((model) => ({ value: model.id, label: model.label }));
const EFFORT_OPTIONS: readonly DropdownOption<AgentEffort>[] = AGENT_EFFORTS.map((effort) => ({ value: effort.id, label: effort.label }));

/** Anthropic's 2000 px edge (T3 imageAttachmentSize), applied before upload on web. */
async function fitImage(file: Blob, mime: string): Promise<Blob> {
  const type = downscalableImageMimeType(mime);
  if (!type || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitImageAttachmentSize(bitmap);
    if (!size) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), type, 0.92));
  } catch {
    return file;
  }
}

async function stageFiles(files: readonly File[]): Promise<StagedAttachment[]> {
  return Promise.all(files.map(async (file, index) => {
    const mime = file.type || "application/octet-stream";
    const blob = await fitImage(file, mime);
    return { uri: URL.createObjectURL(blob), blob, name: file.name || `pasted-${index + 1}`, mime, isImage: mime.startsWith("image/"), cleanup: "object-url" as const, size: blob.size };
  }));
}

export function AgentInput({ running, history, choice, onChoice, onSend, onStop }: {
  readonly running: boolean;
  /** What the user asked before, oldest first, for the up arrow. */
  readonly history: readonly string[];
  readonly choice: AgentModelChoice;
  readonly onChoice: (choice: AgentModelChoice) => void;
  readonly onSend: (intent: SendIntent) => void;
  readonly onStop: () => void;
}) {
  const theme = useTheme();
  const type = useTypeRamp();
  const showSheet = useActionSheet();
  const inputRef = useRef<TextInput>(null);
  const cardRef = useRef<View>(null);
  const attachRef = useRef<View>(null);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<readonly StagedAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const textRef = useRef(text);
  textRef.current = text;
  const historyRef = useRef(history);
  historyRef.current = history;
  const recalled = useRef<HistoryCursor>(NO_RECALL);

  const stage = (incoming: readonly StagedAttachment[]) => {
    if (incoming.length === 0) return;
    const sized = splitOversized(incoming, AGENT_ATTACHMENT_LIMIT);
    const merged = mergePendingAttachments(stagedRef.current, sized.items);
    for (const rejected of [...sized.rejected, ...merged.rejected]) if (rejected.cleanup === "object-url") URL.revokeObjectURL(rejected.uri);
    if (sized.rejected.length > 0) showToast(`${sized.rejected.length === 1 ? `${sized.rejected[0]!.name} is` : `${sized.rejected.length} files are`} over the 100 MB limit`);
    else if (merged.rejected.length > 0) showToast(`You can attach up to ${MAX_PENDING_ATTACHMENTS} items`);
    setStaged(merged.items);
  };
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const canSend = text.trim() !== "" || staged.length > 0;
  const send = (alternate: boolean) => {
    if (!canSend) return;
    setText("");
    setStaged([]);
    recalled.current = NO_RECALL;
    onSend({ text: text.trim(), alternate, attachments: staged });
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => registerFocusTarget("agent-input", () => inputRef.current?.focus()), []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    const card = cardRef.current as unknown as HTMLElement | null;
    if (!node || !card || typeof node.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const caret = { start: node.selectionStart, end: node.selectionEnd };
        const step = stepPromptHistory(historyRef.current, recalled.current, textRef.current, caret, event.key === "ArrowUp" ? "back" : "forward");
        if (!step) return;
        event.preventDefault();
        recalled.current = step;
        setText(step.text);
        return;
      }
      if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (event.isComposing || event.repeat) return;
      sendRef.current(event.altKey);
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = filesFromTransfer(event.clipboardData);
      if (files.length > 0) {
        event.preventDefault();
        void stageFiles(files).then((assets) => stageRef.current(assets));
        return;
      }
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      if (pastedTextDisposition({ text: pasted, canAttach: stagedRef.current.length < MAX_PENDING_ATTACHMENTS }) !== "attachment") return;
      event.preventDefault();
      const blob = new Blob([pasted], { type: "text/plain" });
      const name = nextPastedTextFileName(stagedRef.current.map((attachment) => attachment.name));
      stageRef.current([{ uri: "", blob, name, mime: "text/plain", isImage: false, cleanup: null }]);
    };
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!card.contains(event.relatedTarget as Node | null)) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      void stageFiles(filesFromTransfer(event.dataTransfer)).then((assets) => stageRef.current(assets));
    };
    node.addEventListener("keydown", onKeyDown);
    node.addEventListener("paste", onPaste);
    card.addEventListener("dragover", onDragOver);
    card.addEventListener("dragleave", onDragLeave);
    card.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      node.removeEventListener("paste", onPaste);
      card.removeEventListener("dragover", onDragOver);
      card.removeEventListener("dragleave", onDragLeave);
      card.removeEventListener("drop", onDrop);
    };
  }, []);

  const openPicker = () => {
    // Loaded on use: a static import would put the pickers, which the composer shares, in every first visit's bundle.
    type Pickers = typeof import("@/lib/attachment-pickers");
    const pick = (name: keyof Pickers) => () => void import("@/lib/attachment-pickers").then((pickers) => pickers[name]()).then(stage);
    const actions = [{ label: "Photo or Video Library", onPress: pick("pickPhotos") }];
    if (Platform.OS !== "web") {
      actions.unshift({ label: "Take Photo or Video", onPress: pick("takePhoto") });
      actions.push({ label: "Paste Image", onPress: pick("pasteNativeImage") });
    }
    actions.push({ label: "File", onPress: pick("pickFiles") });
    if (Platform.OS === "web" && attachRef.current) attachRef.current.measureInWindow((x, y) => showSheet({ actions, anchor: { x, y } }));
    else showSheet({ actions });
  };

  const remove = (index: number) => {
    const removed = staged[index];
    if (removed?.cleanup === "object-url") URL.revokeObjectURL(removed.uri);
    setStaged(staged.filter((_, at) => at !== index));
  };

  return (
    <View style={styles.bar}>
      <View
        ref={cardRef}
        testID="agent-input-card"
        style={[styles.card, { backgroundColor: theme.surface, borderColor: dragging ? theme.accent : theme.dividerStrong }]}
      >
        {staged.length > 0 ? (
          <View style={styles.staged}>
            {staged.map((attachment, index) => <StagedChip key={`${attachment.name}-${index}`} attachment={attachment} onRemove={() => remove(index)} />)}
          </View>
        ) : null}
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
            { color: theme.text, fontSize: type.body },
          ]}
        />
        <View style={styles.tools}>
          <View ref={attachRef}>
            <IconButton label="Attach files" onPress={openPicker}>
              {({ active }) => <Ionicons name="add" size={18} color={active ? theme.text : theme.icon} />}
            </IconButton>
          </View>
          <Dropdown variant="chip" label="Model" value={choice.model} options={MODEL_OPTIONS} menuWidth={184} onChange={(model) => onChoice(withModel(model))} />
          <Dropdown variant="chip" label="Effort" value={choice.effort} options={EFFORT_OPTIONS} menuWidth={150} onChange={(effort) => onChoice({ ...choice, effort })} />
          <View style={styles.sendGroup}>
            {running ? (
              <RoundButton label="Stop" fill={theme.field} onPress={onStop}>
                <Ionicons name="stop" size={12} color={theme.text} />
              </RoundButton>
            ) : null}
            <RoundButton label="Send" fill={theme.accent} disabled={!canSend} onPress={() => send(false)}>
              <Ionicons name="arrow-up" size={17} color={theme.onAccent} />
            </RoundButton>
          </View>
        </View>
      </View>
    </View>
  );
}

function StagedChip({ attachment, onRemove }: { readonly attachment: StagedAttachment; readonly onRemove: () => void }) {
  const theme = useTheme();
  const outline = useColorScheme() === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  return (
    <View testID="agent-staged-attachment" accessible accessibilityLabel={attachment.name} style={styles.stagedItem}>
      {attachment.isImage && attachment.uri ? (
        <Image source={{ uri: attachment.uri }} contentFit="cover" style={[styles.stagedThumb, { borderColor: outline }]} />
      ) : (
        <View style={[styles.stagedFile, { backgroundColor: theme.field }]}>
          <Ionicons name="document-text-outline" size={14} color={theme.icon} />
          <Text numberOfLines={1} style={[styles.stagedName, { color: theme.textSecondary }]}>{attachment.name}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${attachment.name}`}
        hitSlop={8}
        onPress={onRemove}
        style={[styles.remove, { backgroundColor: theme.text }]}
      >
        <Ionicons name="close" size={10} color={theme.background} />
      </Pressable>
    </View>
  );
}

/** The thread composer's round send button, at the 28pt icon-button size. */
function RoundButton({ label, fill, disabled, onPress, children }: {
  readonly label: string;
  readonly fill: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.round,
        { backgroundColor: fill, opacity: disabled ? 0.4 : pressed ? PRESS_DIM : hovered ? HOVER_DIM : 1 },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingBottom: Space.gutter, paddingHorizontal: Space.gutter, paddingTop: Space.xs },
  card: { borderRadius: Radius.lg, borderWidth: 1 },
  staged: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm, paddingHorizontal: Space.lg, paddingTop: Space.lg },
  stagedItem: { position: "relative" },
  stagedThumb: { borderRadius: Radius.sm, borderWidth: 1, height: 48, width: 48 },
  stagedFile: { alignItems: "center", borderRadius: Radius.sm, flexDirection: "row", gap: Space.xs, height: 48, maxWidth: 180, paddingHorizontal: Space.md },
  stagedName: { flexShrink: 1, fontSize: 12 },
  remove: { alignItems: "center", borderRadius: Radius.full, height: 16, justifyContent: "center", position: "absolute", right: -5, top: -5, width: 16 },
  input: { maxHeight: 160, minHeight: 44, paddingBottom: Space.xs, paddingHorizontal: Space.lg, paddingTop: Space.lg },
  tools: { alignItems: "center", flexDirection: "row", gap: Space.xxs, paddingBottom: Space.md, paddingHorizontal: Space.md },
  sendGroup: { flexDirection: "row", gap: Space.sm, marginLeft: "auto" },
  round: { alignItems: "center", borderRadius: Radius.full, height: 28, justifyContent: "center", width: 28 },
  pressed: { transform: [{ scale: 0.96 }] },
});
