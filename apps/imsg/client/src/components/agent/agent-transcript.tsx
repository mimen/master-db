import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Fonts } from "@/constants/theme";
import { Radius, Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import type { AgentAttachmentMeta, AgentEntry, AgentItem, AgentTodo } from "@/lib/agent-api";
import { attachmentPreviews } from "@/lib/agent-pane";
import { formatWorking, stepInput, stepLabel, stepOutput, stoppedLabel, type LiveStatus, type TranscriptRow } from "@/lib/agent-transcript";

import { AgentMarkdown } from "./agent-markdown";
import { CopyButton } from "./copy-button";
import { QuestionCard, RaisedCard } from "./question-card";
import { createDelayedStatus, type ShownStatus } from "./vendor/delayed-status";
import { normalizeTerminalOutput, TERMINAL_PALETTES, terminalOutputSpans } from "./vendor/terminal-output";

type Entry<Kind extends AgentEntry["kind"]> = Extract<AgentEntry, { kind: Kind }>;

export interface TranscriptActions {
  readonly onAnswer: (requestId: string, answers: Record<string, string>) => Promise<void>;
  readonly onUseDraft: (item: AgentItem) => Promise<void>;
  /** A row grew or shrank because the user expanded it; scroll-follow must not jump. */
  readonly onDisclosure: () => void;
}

function Disclosure({ label, testID, onToggle, children }: {
  readonly label: string;
  readonly testID?: string;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => {
          setOpen((value) => !value);
          onToggle();
        }}
        style={({ hovered }) => [styles.disclosure, hovered && { backgroundColor: theme.rowHover }]}
      >
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={12} color={theme.textTertiary} />
        <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>{label}</Text>
      </Pressable>
      {open ? <View style={styles.disclosed}>{children}</View> : null}
    </View>
  );
}

/** Terminal output with its ANSI colors as styled spans, on the theme's terminal palette. */
function TerminalText({ text }: { readonly text: string }) {
  const theme = useTheme();
  const palette = TERMINAL_PALETTES[useColorScheme() === "dark" ? "dark" : "light"];
  const spans = useMemo(() => terminalOutputSpans(normalizeTerminalOutput(text).text, palette), [text, palette]);
  return (
    <Text testID="agent-step-output" selectable style={[styles.detail, styles.block, { backgroundColor: theme.field, color: theme.textSecondary }]}>
      {spans.map((span, index) => span.style ? <Text key={index} style={span.style}>{span.text}</Text> : span.text)}
    </Text>
  );
}

function StepDetail({ entry }: { readonly entry: Entry<"tool"> }) {
  const theme = useTheme();
  const input = stepInput(entry.input);
  const output = stepOutput(entry);
  return (
    <View testID="agent-step-detail" style={styles.stepDetail}>
      {input?.command ? <Text selectable style={[styles.detail, { color: theme.text }]}>$ {input.command}</Text> : null}
      {input?.args?.map(([key, value]) => (
        <View key={key} style={styles.arg}>
          <Text style={[styles.meta, styles.argKey, { color: theme.textTertiary }]}>{key}</Text>
          <Text selectable style={[styles.detail, styles.argValue, { color: theme.text }]}>{value}</Text>
        </View>
      ))}
      {input?.text ? <Text selectable style={[styles.detail, { color: theme.text }]}>{input.text}</Text> : null}
      {output ? <TerminalText text={output} /> : null}
    </View>
  );
}

function ToolStep({ entry, onToggle }: { readonly entry: Entry<"tool">; readonly onToggle: () => void }) {
  const theme = useTheme();
  const label = entry.status === "running" ? `${stepLabel(entry)}…` : stepLabel(entry);
  if (!entry.input && !stepOutput(entry)) return <Text numberOfLines={2} style={[styles.meta, styles.step, { color: theme.textSecondary }]}>{label}</Text>;
  return (
    <Disclosure label={label} onToggle={onToggle}>
      <StepDetail entry={entry} />
    </Disclosure>
  );
}

function Thinking({ entry, onToggle }: { readonly entry: Entry<"thinking">; readonly onToggle: () => void }) {
  return (
    <Disclosure label={entry.streaming ? "Thinking…" : "Thought"} onToggle={onToggle}>
      <AgentMarkdown text={entry.text} />
    </Disclosure>
  );
}

function FailedStep({ entry }: { readonly entry: Entry<"tool"> }) {
  const theme = useTheme();
  const output = stepOutput(entry);
  return (
    <View accessibilityRole="alert" style={[styles.failed, { borderLeftColor: theme.destructive }]}>
      <Text style={[styles.meta, { color: theme.destructive }]}>Failed · {stepLabel(entry)}</Text>
      {output ? <Text selectable numberOfLines={6} style={[styles.detail, { color: theme.textSecondary }]}>{output}</Text> : null}
    </View>
  );
}

const TODO_ICON = { pending: "ellipse-outline", in_progress: "radio-button-on", completed: "checkmark-circle" } as const;
const TODO_STATE = { pending: "to do", in_progress: "in progress", completed: "done" } as const;

/** The agent's TodoWrite list. The step that wrote it is hidden; this card is its only trace. */
function TodoList({ todos }: { readonly todos: readonly AgentTodo[] }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const done = todos.filter((todo) => todo.status === "completed").length;
  const color = { pending: theme.textTertiary, in_progress: theme.accent, completed: theme.success } as const;
  return (
    <RaisedCard testID="agent-todos" style={styles.todos}>
      <Text style={[styles.meta, { color: theme.textTertiary }]}>Tasks · {done} of {todos.length} done</Text>
      {todos.map((todo, index) => (
        <View key={index} accessible accessibilityLabel={`${todo.content}, ${TODO_STATE[todo.status]}`} style={styles.todo}>
          <Ionicons name={TODO_ICON[todo.status]} size={15} color={color[todo.status]} style={styles.todoIcon} />
          <Text style={[
            { flex: 1, fontSize: type.secondary, lineHeight: 18 },
            todo.status === "completed" ? { color: theme.textTertiary, textDecorationLine: "line-through" }
              : todo.status === "in_progress" ? { color: theme.text, fontWeight: Weight.semibold } : { color: theme.textSecondary },
          ]}>
            {todo.status === "in_progress" ? todo.activeForm || todo.content : todo.content}
          </Text>
        </View>
      ))}
    </RaisedCard>
  );
}

function UserAttachments({ itemKey, attachments }: { readonly itemKey: string; readonly attachments: readonly AgentAttachmentMeta[] }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const previews = attachmentPreviews.get(itemKey);
  const outline = scheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  return (
    <View style={styles.userAttachments}>
      {attachments.map((attachment, index) => {
        const preview = previews?.[index];
        return preview && attachment.mimeType.startsWith("image/") ? (
          <Image key={index} accessibilityLabel={attachment.filename} source={{ uri: preview }} contentFit="cover" style={[styles.thumb, { borderColor: outline }]} />
        ) : (
          <View key={index} accessible accessibilityLabel={attachment.filename} style={[styles.fileChip, { backgroundColor: theme.surface }]}>
            <Ionicons name={attachment.mimeType.startsWith("image/") ? "image-outline" : "document-text-outline"} size={14} color={theme.icon} />
            <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary, flexShrink: 1 }]}>{attachment.filename}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DraftCard({ item, entry, onUse }: { readonly item: AgentItem; readonly entry: Entry<"draft">; readonly onUse: (item: AgentItem) => Promise<void> }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <RaisedCard testID="agent-draft">
      <Text style={[styles.meta, { color: theme.textTertiary }]}>Draft reply · you have text in the composer</Text>
      {entry.note ? <Text style={[styles.meta, { color: theme.textSecondary }]}>{entry.note}</Text> : null}
      <Text selectable style={{ color: theme.text, fontSize: type.body, lineHeight: Math.round(type.body * 1.5) }}>{entry.text}</Text>
      {entry.attachments?.map((attachment) => (
        <View key={attachment.storageId} style={styles.attachment}>
          <Ionicons name="document-attach-outline" size={14} color={theme.icon} />
          <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>{attachment.filename}</Text>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>{error}</Text> : null}
      <View style={styles.cardActions}>
        <Button
          label={entry.used ? "In the composer" : placing ? "Placing…" : "Use in composer"}
          variant={entry.used ? "ghost" : "primary"}
          disabled={entry.used || placing}
          onPress={() => {
            setPlacing(true);
            setError(null);
            onUse(item).catch(() => setError("Couldn't place the draft. Try again.")).finally(() => setPlacing(false));
          }}
        />
      </View>
    </RaisedCard>
  );
}

function ItemRow({ item, shortcuts, actions }: { readonly item: AgentItem; readonly shortcuts: boolean; readonly actions: TranscriptActions }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const entry = item.entry;
  switch (entry.kind) {
    case "user":
      return (
        <View testID="agent-user-message" style={[styles.user, { backgroundColor: theme.field }]}>
          {entry.steer ? <Text style={[styles.meta, { color: theme.textTertiary }]}>Sent while working</Text> : null}
          {entry.attachments?.length ? <UserAttachments itemKey={item.key} attachments={entry.attachments} /> : null}
          {entry.text ? <Text selectable style={{ color: theme.text, fontSize: type.body, lineHeight: Math.round(type.body * 1.45) }}>{entry.text}</Text> : null}
        </View>
      );
    case "assistant":
      return (
        <View testID="agent-reply" style={styles.reply}>
          <AgentMarkdown text={entry.text} />
          {entry.streaming ? null : <View style={styles.replyActions}><CopyButton text={entry.text} label="Copy reply" /></View>}
        </View>
      );
    case "thinking":
      return <Thinking entry={entry} onToggle={actions.onDisclosure} />;
    case "tool":
      return entry.status === "failed" ? <FailedStep entry={entry} /> : <ToolStep entry={entry} onToggle={actions.onDisclosure} />;
    case "todos":
      return <TodoList todos={entry.todos} />;
    case "question":
      return <QuestionCard entry={entry} shortcuts={shortcuts} onAnswer={(answers) => actions.onAnswer(entry.requestId, answers)} />;
    case "draft":
      return entry.placed === "pane"
        ? <DraftCard item={item} entry={entry} onUse={actions.onUseDraft} />
        : <Text style={[styles.meta, { color: theme.textTertiary }]}>Put a reply in the composer</Text>;
    case "turn_end":
      return entry.outcome === "failed"
        ? <Text accessibilityRole="alert" selectable style={[styles.meta, { color: theme.destructive }]}>{entry.error || "The agent stopped with an error."}</Text>
        : <Text style={[styles.meta, { color: theme.textTertiary }]}>{stoppedLabel(entry.durationMs)}</Text>;
  }
}

export const TranscriptRowView = memo(function TranscriptRowView({ row, shortcuts, actions }: {
  readonly row: TranscriptRow;
  readonly shortcuts: boolean;
  readonly actions: TranscriptActions;
}) {
  switch (row.kind) {
    case "item":
      return <ItemRow item={row.item} shortcuts={shortcuts} actions={actions} />;
    case "turn":
      return (
        <Disclosure testID="agent-turn" label={row.label} onToggle={actions.onDisclosure}>
          {row.rows.map((inner) => <TranscriptRowView key={inner.key} row={inner} shortcuts={false} actions={actions} />)}
        </Disclosure>
      );
    case "work":
      return (
        <Disclosure testID="agent-work" label={row.running ? `${row.summary}…` : row.summary} onToggle={actions.onDisclosure}>
          {row.items.map((item) =>
            item.entry.kind === "thinking"
              ? <Thinking key={item.key} entry={item.entry} onToggle={actions.onDisclosure} />
              : item.entry.kind === "tool"
                ? <ToolStep key={item.key} entry={item.entry} onToggle={actions.onDisclosure} />
                : null)}
        </Disclosure>
      );
  }
});

/** T3's useDelayedStatus (apps/web/src/hooks/useDelayedStatus.ts), over the vendored timer. */
function useDelayedStatus<A>(key: string, value: A | null): A | null {
  const [shown, setShown] = useState<ShownStatus<A> | null>(null);
  const [status] = useState(() => createDelayedStatus<A>(setShown));
  useEffect(() => () => status.dispose(), [status]);
  useEffect(() => {
    status.update(key, value);
  }, [status, key, value]);
  return shown?.key === key ? shown.value : null;
}

/**
 * "Working 1m 05s" and the latest thought, under a running turn. It appears after 400 ms and stays
 * at least 400 ms, and only this line re-renders each second.
 */
export function WorkingStatus({ chatKey, status }: { readonly chatKey: string; readonly status: LiveStatus | null }) {
  const theme = useTheme();
  const last = useRef(status);
  if (status) last.current = status;
  const visible = useDelayedStatus(chatKey, status ? "working" : null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visible]);
  const shown = visible ? last.current : null;
  if (!shown) return null;
  return (
    <View testID="agent-status" accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.status}>
      <Text style={[styles.meta, styles.timer, { color: theme.textSecondary }]}>Working {formatWorking(now - shown.startedAt)}</Text>
      {shown.thought ? <Text numberOfLines={1} style={[styles.meta, styles.thought, { color: theme.textTertiary }]}>{shown.thought}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 12, lineHeight: 17 },
  disclosure: { alignItems: "center", alignSelf: "flex-start", borderRadius: Radius.sm, flexDirection: "row", gap: Space.xs, marginLeft: -Space.sm, maxWidth: "100%", minHeight: 28, paddingHorizontal: Space.sm },
  disclosed: { gap: Space.sm, paddingBottom: Space.xs, paddingLeft: Space.lg },
  step: { paddingVertical: Space.xxs },
  detail: { fontFamily: Fonts.mono, fontSize: 11.5, lineHeight: 16 },
  block: { borderRadius: Radius.sm, overflow: "hidden", paddingHorizontal: Space.md, paddingVertical: Space.sm },
  stepDetail: { gap: Space.xs, paddingBottom: Space.xs },
  arg: { flexDirection: "row", gap: Space.md },
  argKey: { width: 72 },
  argValue: { flex: 1, minWidth: 0 },
  failed: { borderLeftWidth: 2, gap: Space.xs, paddingLeft: Space.md },
  todos: { gap: Space.xs },
  todo: { alignItems: "flex-start", flexDirection: "row", gap: Space.sm },
  todoIcon: { marginTop: 1.5 },
  user: { alignSelf: "flex-end", borderRadius: Radius.md, gap: Space.xs, maxWidth: "88%", paddingHorizontal: Space.lg, paddingVertical: Space.md },
  userAttachments: { flexDirection: "row", flexWrap: "wrap", gap: Space.xs },
  thumb: { borderRadius: Radius.sm, borderWidth: 1, height: 64, width: 64 },
  fileChip: { alignItems: "center", borderRadius: Radius.sm, flexDirection: "row", gap: Space.xs, maxWidth: 220, paddingHorizontal: Space.md, paddingVertical: Space.xs },
  reply: { gap: Space.xxs },
  replyActions: { flexDirection: "row", marginLeft: -Space.sm + 2 },
  cardActions: { alignItems: "flex-end" },
  attachment: { alignItems: "center", flexDirection: "row", gap: Space.sm },
  status: { gap: Space.xxs },
  timer: { fontVariant: ["tabular-nums"] },
  thought: { fontStyle: "italic" },
});
