import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Fonts } from "@/constants/theme";
import { Radius, Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import type { AgentEntry, AgentItem } from "@/lib/agent-api";
import type { TranscriptRow } from "@/lib/agent-transcript";

import { AgentMarkdown } from "./agent-markdown";
import { QuestionCard } from "./question-card";

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

function ToolStep({ entry, onToggle }: { readonly entry: Entry<"tool">; readonly onToggle: () => void }) {
  const theme = useTheme();
  const label = entry.status === "running" ? `${entry.summary || entry.name}…` : entry.summary || entry.name;
  if (!entry.detail) return <Text numberOfLines={2} style={[styles.meta, styles.step, { color: theme.textSecondary }]}>{label}</Text>;
  return (
    <Disclosure label={label} onToggle={onToggle}>
      <Text selectable style={[styles.detail, { color: theme.textSecondary }]}>{entry.detail}</Text>
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
  return (
    <View accessibilityRole="alert" style={[styles.failed, { borderLeftColor: theme.destructive }]}>
      <Text style={[styles.meta, { color: theme.destructive }]}>Failed · {entry.summary || entry.name}</Text>
      {entry.detail ? <Text selectable numberOfLines={6} style={[styles.detail, { color: theme.textSecondary }]}>{entry.detail}</Text> : null}
    </View>
  );
}

function DraftCard({ item, entry, onUse }: { readonly item: AgentItem; readonly entry: Entry<"draft">; readonly onUse: (item: AgentItem) => Promise<void> }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View testID="agent-draft" style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
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
    </View>
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
          <Text selectable style={{ color: theme.text, fontSize: type.body, lineHeight: Math.round(type.body * 1.45) }}>{entry.text}</Text>
        </View>
      );
    case "assistant":
      return <View testID="agent-reply"><AgentMarkdown text={entry.text} /></View>;
    case "thinking":
      return <Thinking entry={entry} onToggle={actions.onDisclosure} />;
    case "tool":
      return entry.status === "failed" ? <FailedStep entry={entry} /> : <ToolStep entry={entry} onToggle={actions.onDisclosure} />;
    case "question":
      return <QuestionCard entry={entry} shortcuts={shortcuts} onAnswer={(answers) => actions.onAnswer(entry.requestId, answers)} />;
    case "draft":
      return entry.placed === "pane"
        ? <DraftCard item={item} entry={entry} onUse={actions.onUseDraft} />
        : <Text style={[styles.meta, { color: theme.textTertiary }]}>Put a reply in the composer</Text>;
    case "turn_end":
      return entry.outcome === "failed"
        ? <Text accessibilityRole="alert" selectable style={[styles.meta, { color: theme.destructive }]}>{entry.error || "The agent stopped with an error."}</Text>
        : <Text style={[styles.meta, { color: theme.textTertiary }]}>Stopped</Text>;
  }
}

export const TranscriptRowView = memo(function TranscriptRowView({ row, shortcuts, actions }: {
  readonly row: TranscriptRow;
  readonly shortcuts: boolean;
  readonly actions: TranscriptActions;
}) {
  if (row.kind === "item") return <ItemRow item={row.item} shortcuts={shortcuts} actions={actions} />;
  const steps = `${row.steps} ${row.steps === 1 ? "step" : "steps"}`;
  return (
    <Disclosure testID="agent-work" label={row.running ? `Working · ${steps}` : `Worked for ${row.seconds < 1 ? "<1" : row.seconds}s · ${steps}`} onToggle={actions.onDisclosure}>
      {row.items.map((item) =>
        item.entry.kind === "thinking"
          ? <Thinking key={item.key} entry={item.entry} onToggle={actions.onDisclosure} />
          : item.entry.kind === "tool"
            ? <ToolStep key={item.key} entry={item.entry} onToggle={actions.onDisclosure} />
            : null)}
    </Disclosure>
  );
});

const styles = StyleSheet.create({
  meta: { fontSize: 12, lineHeight: 17 },
  disclosure: { alignItems: "center", alignSelf: "flex-start", borderRadius: Radius.sm, flexDirection: "row", gap: Space.xs, marginLeft: -Space.sm, maxWidth: "100%", minHeight: 28, paddingHorizontal: Space.sm },
  disclosed: { gap: Space.sm, paddingBottom: Space.xs, paddingLeft: Space.lg },
  step: { paddingVertical: Space.xxs },
  detail: { fontFamily: Fonts.mono, fontSize: 11.5, lineHeight: 16 },
  failed: { borderLeftWidth: 2, gap: Space.xs, paddingLeft: Space.md },
  user: { alignSelf: "flex-end", borderRadius: Radius.md, gap: Space.xxs, maxWidth: "88%", paddingHorizontal: Space.lg, paddingVertical: Space.md },
  card: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, gap: Space.md, padding: Space.lg },
  cardActions: { alignItems: "flex-end" },
  attachment: { alignItems: "center", flexDirection: "row", gap: Space.sm },
});
