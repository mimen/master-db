import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import { Button } from "@/components/ui/button";
import { Radius, Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import type { AgentEntry } from "@/lib/agent-api";
import {
  EMPTY_SELECTION,
  questionAnswer,
  questionAnswers,
  questionShortcut,
  toggleOption,
  toggleOther,
  type QuestionSelection,
} from "@/lib/agent-transcript";

type QuestionEntry = Extract<AgentEntry, { kind: "question" }>;

/** A card in the transcript: a 1px edge and a soft lift, so it stands off the white pane. */
export function RaisedCard({ testID, style, children }: { readonly testID: string; readonly style?: StyleProp<ViewStyle>; readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.dividerStrong },
        Platform.OS === "web" && ({ boxShadow: theme.raisedShadow } as ViewStyle),
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** T3 lets a single-select pick land visibly before it advances. */
const AUTO_ADVANCE_MS = 200;

/** Digits may answer while focus is outside every field, or in the empty pane input. */
function digitTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest("[data-agent-input]")) return (target as HTMLTextAreaElement).value === "";
  return !(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function QuestionCard({ entry, shortcuts, onAnswer }: {
  readonly entry: QuestionEntry;
  /** Only the newest pending question listens for number keys. */
  readonly shortcuts: boolean;
  readonly onAnswer: (answers: Record<string, string>) => Promise<void>;
}) {
  const theme = useTheme();
  const type = useTypeRamp();
  const [selections, setSelections] = useState<Record<string, QuestionSelection>>({});
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = entry.status === "pending";
  const editable = pending && !sending;
  const answers = questionAnswers(entry.questions, selections);

  const submit = (next: Record<string, string> | null) => {
    if (!next || sending) return;
    setSending(true);
    setError(null);
    onAnswer(next).catch(() => setError("Couldn't send the answer. Try again.")).finally(() => setSending(false));
  };

  const pick = (questionIndex: number, label: string) => {
    const question = entry.questions[questionIndex];
    if (!question || !editable) return;
    const next = { ...selections, [question.question]: toggleOption(question, selections[question.question] ?? EMPTY_SELECTION, label) };
    setSelections(next);
    setActive(questionIndex);
    if (question.multiSelect) return;
    const nextOpen = entry.questions.findIndex((q) => questionAnswer(next[q.question]) === null);
    if (nextOpen >= 0) setActive(nextOpen);
    else setTimeout(() => submit(questionAnswers(entry.questions, next)), AUTO_ADVANCE_MS);
  };

  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    if (Platform.OS !== "web" || !editable || !shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !digitTarget(event.target)) return;
      const question = entry.questions[active];
      const index = question ? questionShortcut(event.key, question.options.length) : null;
      if (question === undefined || index === null) return;
      event.preventDefault();
      event.stopPropagation();
      pickRef.current(active, question.options[index]!.label);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, editable, entry.questions, shortcuts]);

  return (
    <RaisedCard testID="agent-question" style={styles.questionCard}>
      {entry.questions.map((question, questionIndex) => {
        const selection = selections[question.question] ?? EMPTY_SELECTION;
        if (!pending) {
          return (
            <View key={question.question} style={styles.question}>
              <Text style={[styles.title, { color: theme.text, fontSize: type.body }]}>{question.question}</Text>
              <Text selectable style={{ color: theme.textSecondary, fontSize: type.body }}>
                {entry.status === "cancelled" ? "Not answered" : entry.answers?.[question.question] ?? ""}
              </Text>
            </View>
          );
        }
        return (
          <View key={question.question} accessibilityRole={question.multiSelect ? undefined : "radiogroup"} accessibilityLabel={question.question} style={styles.question}>
            {question.header ? <Text style={[styles.hint, { color: theme.textTertiary }]}>{question.header}</Text> : null}
            <Text style={[styles.title, { color: theme.text, fontSize: type.body }]}>{question.question}</Text>
            {question.options.map((option, optionIndex) => {
              const checked = selection.labels.includes(option.label);
              return (
                <Pressable
                  key={option.label}
                  accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                  accessibilityState={{ checked, disabled: !editable }}
                  accessibilityLabel={option.label}
                  disabled={!editable}
                  onPress={() => pick(questionIndex, option.label)}
                  style={({ hovered }) => [styles.option, { borderColor: checked ? theme.accent : theme.divider }, hovered && { backgroundColor: theme.rowHover }]}
                >
                  <Text style={[styles.number, { color: active === questionIndex ? theme.text : theme.textTertiary }]}>{optionIndex + 1}</Text>
                  <View style={styles.optionBody}>
                    <Text style={{ color: theme.text, fontSize: type.body }}>{option.label}</Text>
                    {option.description ? <Text style={[styles.hint, { color: theme.textSecondary }]}>{option.description}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
              accessibilityState={{ checked: selection.useOther, disabled: !editable }}
              accessibilityLabel="Other"
              disabled={!editable}
              onPress={() => {
                setActive(questionIndex);
                setSelections((current) => ({ ...current, [question.question]: toggleOther(question, current[question.question] ?? EMPTY_SELECTION) }));
              }}
              style={({ hovered }) => [styles.option, { borderColor: selection.useOther ? theme.accent : theme.divider }, hovered && { backgroundColor: theme.rowHover }]}
            >
              <Text style={[styles.number, { color: theme.textTertiary }]}> </Text>
              <Text style={{ color: theme.text, fontSize: type.body }}>Other…</Text>
            </Pressable>
            {selection.useOther ? (
              <TextInput
                autoFocus
                accessibilityLabel={`Your answer to ${question.question}`}
                editable={editable}
                value={selection.other}
                onFocus={() => setActive(questionIndex)}
                onChangeText={(other) => setSelections((current) => ({ ...current, [question.question]: { ...(current[question.question] ?? EMPTY_SELECTION), other } }))}
                onSubmitEditing={() => submit(answers)}
                placeholder="Type an answer"
                placeholderTextColor={theme.textTertiary}
                style={[styles.input, { borderColor: theme.divider, color: theme.text, fontSize: type.body }]}
              />
            ) : null}
          </View>
        );
      })}
      {error ? <Text accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>{error}</Text> : null}
      {pending ? (
        <View style={styles.footer}>
          <Text style={[styles.hint, { color: theme.textTertiary, flex: 1 }]}>{Platform.OS === "web" && shortcuts ? "Press a number to pick" : ""}</Text>
          <Button label={sending ? "Sending…" : "Answer"} variant="primary" disabled={!answers || sending} onPress={() => submit(answers)} />
        </View>
      ) : null}
    </RaisedCard>
  );
}

const styles = StyleSheet.create({
  /** Concentric: the card radius is its controls' Radius.sm plus its Space.lg padding. */
  card: { borderRadius: Radius.sm + Space.lg, borderWidth: 1, gap: Space.md, padding: Space.lg },
  questionCard: { gap: Space.xl },
  question: { gap: Space.sm },
  title: { fontWeight: Weight.semibold },
  hint: { fontSize: 12, lineHeight: 16 },
  option: { alignItems: "center", borderRadius: Radius.sm, borderWidth: 1, flexDirection: "row", gap: Space.md, minHeight: 36, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  optionBody: { flex: 1, gap: 2 },
  number: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: Weight.semibold, width: 12 },
  input: { borderRadius: Radius.sm, borderWidth: 1, minHeight: 36, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  footer: { alignItems: "center", flexDirection: "row", gap: Space.md },
});
