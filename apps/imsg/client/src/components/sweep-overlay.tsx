import type { ChatSummary } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/lib/api";
import { fillComposer } from "@/lib/composer-fill";
import { useTheme } from "@/hooks/use-theme";
import { finishTriageChat, laterOptions, setTriageLater, undoLastTriageAction } from "@/hooks/use-triage-actions";
import { useActionSheet } from "@/lib/action-sheet";
import { ThreadView } from "./thread-view";

export function SweepOverlay({ visible, chats, startGuid, onClose }: { visible: boolean; chats: ChatSummary[]; startGuid?: string; onClose: () => void }): React.JSX.Element | null {
  const theme = useTheme();
  const showSheet = useActionSheet();
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const [queue, setQueue] = useState<ChatSummary[]>([]);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const chat = queue[index] ?? null;
  const advance = useCallback(() => {
    setHistory((current) => [...current, index]);
    setIndex((current) => Math.min(current + 1, queue.length));
  }, [queue.length, index]);
  const done = useCallback(() => { if (!chat) return; void finishTriageChat(chat).then(advance, () => undefined); }, [advance, chat]);
  const later = useCallback(() => {
    if (!chat) return;
    showSheet({ title: `Later · ${chat.displayName}`, actions: laterOptions().map((option) => ({ label: option.label, onPress: () => { void setTriageLater(chat, option.until).then(advance, () => undefined); } })) });
  }, [advance, chat, showSheet]);

  useEffect(() => {
    if (!visible) return;
    const snapshot = [...chatsRef.current];
    const start = Math.max(0, startGuid ? snapshot.findIndex((item) => item.guid === startGuid) : 0);
    setQueue(snapshot);
    setIndex(start);
    setHistory([]);
  }, [visible, startGuid]);
  useEffect(() => {
    if (!visible || !chat) { setSuggestions([]); return; }
    let cancelled = false; setLoading(true);
    void api.aiSuggestions(chat.guid).then((result) => { if (!cancelled) setSuggestions(result.suggestions.slice(0, 4)); }, () => { if (!cancelled) setSuggestions([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chat, visible]);
  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const keydown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const editable = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable);
      if (editable) return;
      const key = event.key.toLowerCase();
      if (key === "e") { event.preventDefault(); done(); return; }
      if (key === "h") { event.preventDefault(); later(); return; }
      if (key === "z") { event.preventDefault(); if (undoLastTriageAction()) { const prior = history[history.length - 1]; if (prior !== undefined) { setIndex(prior); setHistory((current) => current.slice(0, -1)); } } return; }
      const option = Number(event.key) - 1;
      if (option >= 0 && option < suggestions.length) { event.preventDefault(); const text = suggestions[option]; if (text) fillComposer(text); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [done, history, later, suggestions, visible]);
  if (!visible) return null;
  return <View accessibilityViewIsModal style={[styles.backdrop, { backgroundColor: theme.background }]}>
    <View style={[styles.topbar, { borderBottomColor: theme.divider }]}>
      <View><Text style={[styles.title, { color: theme.text }]}>Sweep</Text><Text style={[styles.progress, { color: theme.textSecondary }]}>{chat ? `${index + 1} of ${queue.length}` : "Desk clear"}</Text></View>
      <View style={styles.topActions}>
        <Pressable disabled={history.length === 0} accessibilityLabel="Undo sweep advance" onPress={() => { const prior = history[history.length - 1]; if (prior !== undefined && undoLastTriageAction()) { setIndex(prior); setHistory((current) => current.slice(0, -1)); } }} style={styles.iconButton}><Ionicons name="arrow-undo" size={19} color={history.length ? theme.text : theme.textSecondary} /></Pressable>
        <Pressable accessibilityLabel="Close sweep" onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={23} color={theme.text} /></Pressable>
      </View>
    </View>
    {chat ? <View style={styles.body}>
      <View style={styles.thread}><ThreadView key={chat.guid} chatGuid={chat.guid} isGroup={chat.isGroup} headerChat={chat} onMessageSent={advance} /></View>
      <View style={[styles.options, { borderLeftColor: theme.divider, backgroundColor: theme.backgroundElement }]}>
        <View style={styles.sweepActions}><Pressable onPress={done} style={[styles.primaryAction, { backgroundColor: theme.accent }]}><Ionicons name="checkmark" size={14} color={theme.onAccent} /><Text style={{ color: theme.onAccent, fontSize: 12, fontWeight: "700" }}>Done  E</Text></Pressable><Pressable onPress={later} style={[styles.secondaryAction, { borderColor: theme.divider }]}><Ionicons name="time-outline" size={14} color={theme.textSecondary} /><Text style={{ color: theme.text, fontSize: 12, fontWeight: "600" }}>Later  H</Text></Pressable></View>
        <Text style={[styles.optionsTitle, { color: theme.text }]}>Reply ideas</Text><Text style={[styles.hint, { color: theme.textSecondary }]}>Press 1–4 to stage a draft. Edit it, then press Enter to send.</Text>
        {loading ? <ActivityIndicator style={{ marginTop: 20 }} /> : suggestions.map((suggestion, option) => <Pressable key={`${option}-${suggestion}`} onPress={() => fillComposer(suggestion)} style={({ pressed }) => [styles.option, { borderColor: theme.divider, backgroundColor: pressed ? theme.backgroundSelected : theme.background }]}><Text style={[styles.number, { color: theme.accent }]}>{option + 1}</Text><Text style={[styles.optionText, { color: theme.text }]}>{suggestion}</Text></Pressable>)}
        <Pressable onPress={advance} style={styles.skip}><Text style={{ color: theme.textSecondary, fontSize: 12 }}>Skip for now</Text><Ionicons name="arrow-forward" size={15} color={theme.textSecondary} /></Pressable>
      </View>
    </View> : <View style={styles.done}><Ionicons name="checkmark-circle" size={42} color={theme.accent} /><Text style={[styles.doneTitle, { color: theme.text }]}>Sweep complete</Text><Pressable onPress={onClose}><Text style={{ color: theme.accent, fontWeight: "600" }}>Return to desk</Text></Pressable></View>}
  </View>;
}
const styles = StyleSheet.create({ backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 100 }, topbar: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 58, justifyContent: "space-between", paddingHorizontal: 18 }, title: { fontSize: 17, fontWeight: "700" }, progress: { fontSize: 11, marginTop: 1 }, topActions: { flexDirection: "row", gap: 8 }, iconButton: { alignItems: "center", height: 34, justifyContent: "center", width: 34 }, body: { flex: 1, flexDirection: "row" }, thread: { flex: 1 }, options: { borderLeftWidth: StyleSheet.hairlineWidth, padding: 18, width: 312 }, sweepActions: { flexDirection: "row", gap: 8, marginBottom: 20 }, primaryAction: { alignItems: "center", borderRadius: 9, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 9 }, secondaryAction: { alignItems: "center", borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 9 }, optionsTitle: { fontSize: 16, fontWeight: "700" }, hint: { fontSize: 11, lineHeight: 16, marginBottom: 16, marginTop: 4 }, option: { borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 9, marginBottom: 9, padding: 11 }, number: { fontSize: 12, fontWeight: "800" }, optionText: { flex: 1, fontSize: 13, lineHeight: 18 }, skip: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "flex-end", marginTop: 8 }, done: { alignItems: "center", flex: 1, gap: 14, justifyContent: "center" }, doneTitle: { fontSize: 22, fontWeight: "700" } });
