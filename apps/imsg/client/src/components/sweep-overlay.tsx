import type { ChatSummary, ReplySuggestion, ReplySuggestions } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/lib/api";
import { patchChatWithMessage } from "@/lib/chat-store";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { settleTriageChat, laterOptions, setTriageLater, undoLastTriageAction } from "@/hooks/use-triage-actions";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { useSuggestionModel } from "@/lib/settings";
import { ChatAvatar } from "./avatar";
import { HoverFillButton } from "./hover-fill-button";

interface SweepStep {
  index: number;
  label?: string;
  undoable: boolean;
}

export function SweepOverlay({ visible, chats, startGuid, onOpenFullThread, onClose }: { visible: boolean; chats: ChatSummary[]; startGuid?: string; onOpenFullThread: (chat: ChatSummary) => void; onClose: () => void }): React.JSX.Element | null {
  const theme = useTheme();
  const visual = useTriageTheme();
  const showSheet = useActionSheet();
  const suggestionModel = useSuggestionModel();
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const [queue, setQueue] = useState<ChatSummary[]>([]);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<SweepStep[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<ReplySuggestion[]>([]);
  const [suggestionResult, setSuggestionResult] = useState<ReplySuggestions | null>(null);
  const [selectedOption, setSelectedOption] = useState(0);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const chat = queue[index] ?? null;

  const advance = useCallback((label?: string, undoable = false) => {
    if (label) setCleared((current) => [...current, label]);
    setHistory((current) => [
      ...current.map((step) => undoable && step.undoable ? { ...step, undoable: false } : step),
      { index, label, undoable },
    ]);
    setIndex((current) => Math.min(current + 1, queue.length));
    setDraft("");
    setSelectedOption(0);
  }, [queue.length, index]);

  const settle = useCallback(() => {
    if (!chat || sending) return;
    if (!chat.flags.unresponded && !chat.flags.waiting) { advance(); return; }
    void settleTriageChat(chat).then(() => advance(`${chat.displayName} · settled`, true), () => undefined);
  }, [advance, chat, sending]);

  const later = useCallback((anchor?: { x: number; y: number }) => {
    if (!chat || sending) return;
    showSheet({
      title: `Later · ${chat.displayName}`,
      anchor,
      actions: laterOptions().map((option) => ({
        label: option.label,
        onPress: () => { void setTriageLater(chat, option.until).then(() => advance(`${chat.displayName} · later`, true), () => undefined); },
      })),
    });
  }, [advance, chat, sending, showSheet]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!chat || !text || sending) return;
    setSending(true);
    const selected = selectedOption < suggestions.length ? suggestions[selectedOption] ?? null : null;
    void api.sendText(chat.guid, { text }).then(
      (message) => {
        patchChatWithMessage(chat.guid, message);
        if (selected && suggestionResult) {
          void api.recordSuggestionFeedback(chat.guid, {
            suggestion: selected,
            selectedModel: suggestionResult.selectedModel,
            servedModel: suggestionResult.servedModel,
            recipeVersion: suggestionResult.recipeVersion,
            selectedAt: Date.now(),
            finalText: text,
          }).catch(() => undefined);
        }
        advance(`${chat.displayName} · replied`);
      },
      () => undefined,
    ).finally(() => setSending(false));
  }, [advance, chat, draft, selectedOption, sending, suggestionResult, suggestions]);

  const undo = useCallback(() => {
    const historyIndex = history.findLastIndex((step) => step.undoable);
    const prior = history[historyIndex];
    if (!prior || !undoLastTriageAction()) return;
    setIndex(prior.index);
    setHistory((current) => current.filter((_, index) => index !== historyIndex));
    if (prior.label) {
      setCleared((current) => {
        const labelIndex = current.lastIndexOf(prior.label!);
        return labelIndex < 0 ? current : current.filter((_, index) => index !== labelIndex);
      });
    }
  }, [history]);

  useEffect(() => {
    if (!visible) return;
    const snapshot = [...chatsRef.current];
    const start = Math.max(0, startGuid ? snapshot.findIndex((item) => item.guid === startGuid) : 0);
    setQueue(snapshot);
    setIndex(start);
    setHistory([]);
    setCleared([]);
    setDraft("");
  }, [visible, startGuid]);

  useEffect(() => {
    if (!visible || !chat) { setSuggestions([]); return; }
    let cancelled = false;
    setLoading(true);
    void api.aiSuggestions(chat.guid, suggestionModel).then(
      (result) => {
        if (cancelled) return;
        const next = result.stale
          ? []
          : result.suggestions.filter((suggestion) => suggestion.kind === "text").slice(0, 2);
        setSuggestionResult(result.stale ? null : result);
        setSuggestions(next);
        setSelectedOption(0);
        setDraft(next[0]?.text ?? "");
      },
      () => { if (!cancelled) { setSuggestionResult(null); setSuggestions([]); } },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chat, suggestionModel, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const keydown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const editable = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable);
      const key = event.key.toLowerCase();
      if (key === "escape") { event.preventDefault(); onClose(); return; }
      if (editable) return;
      if (key === "s") { event.preventDefault(); advance(); return; }
      if (key === "e") { event.preventDefault(); settle(); return; }
      if (key === "h") { event.preventDefault(); later(); return; }
      if (key === "z") { event.preventDefault(); undo(); return; }
      const option = Number(event.key) - 1;
      if (option >= 0 && option <= 2) {
        event.preventDefault();
        setSelectedOption(option);
        setDraft(option < suggestions.length ? suggestions[option]?.text ?? "" : "");
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [advance, later, onClose, settle, suggestions, undo, visible]);

  if (!visible) return null;
  const total = queue.length;
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.overlay,
    backdropFilter: "blur(40px) saturate(1.5)",
    WebkitBackdropFilter: "blur(40px) saturate(1.5)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(0,0,0,0.25)",
  } as object) : { backgroundColor: visual.overlay };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View testID="sweep-backdrop" style={[styles.backdrop, { backgroundColor: "rgba(20,14,24,0.38)" }]}>
        <View accessibilityViewIsModal testID="sweep-card" style={[styles.card, glass]}>
          <View style={[styles.header, { borderBottomColor: visual.hairline }]}>
            <View style={styles.headerTitle}>
              <Ionicons name="flash" size={18} color={visual.text} />
              <Text style={[styles.title, { color: visual.text }]}>Sweep · Needs reply</Text>
            </View>
            <View style={styles.headerActions}>
              <Text style={[styles.progressText, { color: visual.meta }]}>{Math.min(index + 1, total)} of {total}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close sweep" onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={18} color={visual.muted} />
              </Pressable>
            </View>
          </View>

          {chat ? (
            <>
              <View style={styles.body}>
                <View style={styles.personRow}>
                  <ChatAvatar chat={chat} size={40} />
                  <View style={styles.personCopy}>
                    <Text style={[styles.personName, { color: visual.text }]}>{chat.displayName}</Text>
                    <Text style={[styles.waiting, { color: visual.muted }]}>waiting since {chat.lastMessage ? new Date(chat.lastMessage.dateCreated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "now"}</Text>
                  </View>
                  <Pressable onPress={() => advance()} style={styles.skip}>
                    <Text style={[styles.skipText, { color: visual.muted }]}>skip ⇢</Text><Text style={[styles.keycap, { color: visual.muted, borderColor: visual.hairlineStrong }]}>S</Text>
                  </Pressable>
                </View>

                <View style={[styles.contextBubble, { backgroundColor: visual.controlFill }]}>
                  <Text style={[styles.contextText, { color: visual.text }]}>{chat.lastMessage?.text || "Attachment"}</Text>
                </View>
                <Pressable onPress={() => onOpenFullThread(chat)}>
                  <Text style={[styles.openThread, { color: visual.muted }]}>…earlier messages · <Text style={{ color: theme.accent, fontWeight: "600" }}>open full thread ↵</Text></Text>
                </Pressable>

                <View style={styles.options}>
                  {loading ? <ActivityIndicator color={theme.accent} /> : suggestions.map((suggestion, option) => (
                    <Pressable
                      key={suggestion.id}
                      onPress={() => { setSelectedOption(option); setDraft(suggestion.text); }}
                      style={[styles.option, { backgroundColor: visual.card, borderColor: selectedOption === option ? "rgba(0,122,255,0.35)" : visual.hairlineStrong }]}
                    >
                      <Text style={[styles.optionKey, { color: visual.meta, borderColor: visual.hairlineStrong }]}>{option + 1}</Text>
                      <Text numberOfLines={2} style={[styles.optionText, { color: visual.text }]}>{suggestion.text}</Text>
                      {selectedOption === option ? <Pressable accessibilityLabel="Send selected reply" disabled={sending} onPress={send}><Ionicons name="paper-plane-outline" size={16} color={theme.accent} /></Pressable> : <Ionicons name="paper-plane-outline" size={15} color={visual.muted} />}
                    </Pressable>
                  ))}
                  <View style={[styles.option, { backgroundColor: visual.card, borderColor: selectedOption === 2 ? "rgba(0,122,255,0.35)" : visual.hairlineStrong }]}>
                    <Text style={[styles.optionKey, { color: visual.meta, borderColor: visual.hairlineStrong }]}>3</Text>
                    <TextInput
                      value={selectedOption === 2 ? draft : ""}
                      onFocus={() => { setSelectedOption(2); setDraft(""); }}
                      onChangeText={setDraft}
                      onSubmitEditing={send}
                      placeholder="Type your own…"
                      placeholderTextColor={visual.hint}
                      style={[styles.customInput, { color: visual.text }]}
                    />
                    {selectedOption === 2 && draft.trim() ? <Pressable accessibilityLabel="Send custom reply" disabled={sending} onPress={send}><Ionicons name="paper-plane-outline" size={16} color={theme.accent} /></Pressable> : null}
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <HoverFillButton accessibilityLabel="Settle current conversation" onPress={settle} restFill={visual.controlFill} hoverFill={visual.controlFillHover} style={styles.actionChip}><Ionicons name="checkmark" size={14} color={visual.text} /><Text style={[styles.actionText, { color: visual.text }]}>Settle <Text style={{ color: visual.hint }}>E</Text></Text></HoverFillButton>
                  <HoverFillButton accessibilityLabel="Move current conversation to Later" onPress={(event) => later(pressAnchor(event))} restFill={visual.controlFill} hoverFill={visual.controlFillHover} style={styles.actionChip}><Ionicons name="time-outline" size={14} color={visual.text} /><Text style={[styles.actionText, { color: visual.text }]}>Later <Text style={{ color: visual.hint }}>H</Text></Text></HoverFillButton>
                  <Text style={[styles.autoAdvance, { color: visual.hint }]}>sent replies auto-advance to the next</Text>
                </View>
              </View>
              <View style={[styles.footer, { borderTopColor: visual.hairline }]}>
                <View style={styles.clearedLog}>{cleared.slice(-3).map((entry) => <View key={entry} style={styles.clearedItem}><Ionicons name="checkmark-circle-outline" size={14} color="#28A745" /><Text style={[styles.clearedText, { color: visual.meta }]}>{entry}</Text></View>)}</View>
                <Pressable onPress={undo} disabled={!history.some((step) => step.undoable)}><Text style={[styles.undoText, { color: history.some((step) => step.undoable) ? visual.hint : visual.hairlineStrong }]}>Z undoes the last settle</Text></Pressable>
              </View>
            </>
          ) : (
            <View style={styles.complete}><Ionicons name="checkmark-circle" size={42} color="#28A745" /><Text style={[styles.completeTitle, { color: visual.text }]}>Sweep complete</Text><Pressable onPress={onClose}><Text style={{ color: theme.accent, fontWeight: "600" }}>Return to desk</Text></Pressable></View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  card: { borderRadius: 16, maxHeight: "92%", maxWidth: "100%", overflow: "hidden", width: 560 },
  header: { alignItems: "center", borderBottomWidth: 0.5, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 },
  headerTitle: { alignItems: "center", flexDirection: "row", gap: 9 },
  title: { fontSize: 14, fontWeight: "700" },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 10 },
  progressText: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "600" },
  closeButton: { alignItems: "center", height: 28, justifyContent: "center", width: 28 },
  body: { paddingHorizontal: 22, paddingVertical: 20 },
  personRow: { alignItems: "center", flexDirection: "row" },
  personCopy: { flex: 1, marginLeft: 10 },
  personName: { fontSize: 14, fontWeight: "700" },
  waiting: { fontSize: 11, marginTop: 2 },
  skip: { alignItems: "center", flexDirection: "row", gap: 5 },
  skipText: { fontSize: 11 },
  keycap: { borderRadius: 4, borderWidth: 0.5, fontSize: 11, fontWeight: "700", paddingHorizontal: 5, paddingVertical: 1 },
  contextBubble: { alignSelf: "flex-start", borderRadius: 18, marginTop: 18, maxWidth: "80%", paddingHorizontal: 13, paddingVertical: 9 },
  contextText: { fontSize: 15, lineHeight: 20 },
  openThread: { fontSize: 11, marginBottom: 16, marginTop: 5 },
  options: { gap: 7 },
  option: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 40, paddingHorizontal: 12, paddingVertical: 9 },
  optionKey: { borderRadius: 4, borderWidth: 0.5, fontSize: 11, fontWeight: "700", minWidth: 20, paddingHorizontal: 6, paddingVertical: 2, textAlign: "center" },
  optionText: { flex: 1, fontSize: 14, lineHeight: 19 },
  customInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  actionsRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 16 },
  actionChip: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 5, height: 28, paddingHorizontal: 11 },
  actionText: { fontSize: 12, fontWeight: "600" },
  autoAdvance: { flex: 1, fontSize: 11, textAlign: "right" },
  footer: { alignItems: "center", borderTopWidth: 0.5, flexDirection: "row", justifyContent: "space-between", minHeight: 42, paddingHorizontal: 18, paddingVertical: 10 },
  clearedLog: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12, overflow: "hidden" },
  clearedItem: { alignItems: "center", flexDirection: "row", gap: 4 },
  clearedText: { fontSize: 11 },
  undoText: { fontSize: 11 },
  complete: { alignItems: "center", gap: 14, justifyContent: "center", minHeight: 360 },
  completeTitle: { fontSize: 22, fontWeight: "700" },
});
