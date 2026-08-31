import { Ionicons } from "@expo/vector-icons";
import { displayReleaseSha } from "@shared/release-identity";
import type { SuggestionModel } from "@shared/types";
import { useSyncExternalStore, type JSX } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ListRow } from "./list-row";

import { Fonts, Radii, Spacing } from "@/constants/theme";
import { useAiStatus } from "@/hooks/use-ai";
import { useTheme } from "@/hooks/use-theme";
import { releaseStatus } from "@/lib/release-status";
import { api } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import {
  setNameOrder,
  setSuggestionMode,
  setSuggestionModel,
  useNameOrder,
  useSuggestionMode,
  useSuggestionModel,
  type NameOrder,
  type SuggestionMode,
} from "@/lib/settings";

export interface SettingsContentProps {
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
  /** When set, the header shows a back chevron with this label instead of a close X. */
  onBack?: () => void;
  backLabel?: string;
}

const NAME_ORDER_OPTIONS: ReadonlyArray<{ value: NameOrder; label: string }> = [
  { value: "first-last", label: "First Last" },
  { value: "last-first", label: "Last, First" },
];

const SUGGESTION_MODE_OPTIONS: ReadonlyArray<{ value: SuggestionMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "on-demand", label: "On demand" },
  { value: "auto", label: "Automatic" },
];

const SUGGESTION_MODEL_OPTIONS: ReadonlyArray<{ value: SuggestionModel; label: string; detail: string }> = [
  { value: "opus", label: "Opus", detail: "Claude · taste first" },
  { value: "terra", label: "Terra", detail: "ChatGPT · preserves Claude quota" },
];

function ReleaseIdentityFooter(): JSX.Element {
  const theme = useTheme();
  const snapshot = useSyncExternalStore(
    releaseStatus.subscribe,
    releaseStatus.getSnapshot,
    releaseStatus.getSnapshot,
  );
  const rows = [
    ["Environment", snapshot.running.environment],
    ["Branch", snapshot.running.branch ?? "—"],
    ["Running web", displayReleaseSha(snapshot.running.webSha)],
    ["Deployed web", displayReleaseSha(snapshot.deployedWeb?.webSha ?? null)],
    ["Running shell", displayReleaseSha(snapshot.shell.runningSha)],
    ["Staged shell", displayReleaseSha(snapshot.shell.stagedSha)],
  ] as const;

  return (
    <View
      style={[styles.releaseFooter, { borderTopColor: theme.divider }]}
      testID="release-identity-footer"
    >
      {rows.map(([label, value]) => (
        <View key={label} style={styles.releaseRow}>
          <Text style={[styles.releaseLabel, { color: theme.textSecondary }]}>{label}</Text>
          <Text selectable style={[styles.releaseValue, { color: theme.textSecondary }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The app's one settings surface — grouped option cards, iOS-Settings style
 * (see person-content.tsx's edit form for the same card language: persistent
 * inline labels, theme.backgroundElement cards, hairline dividers). Follows
 * the shared-content contract (showHeader/onClose/onBack) so this one
 * component serves both the mobile /settings modal and a future desktop
 * pane — same pattern as person-content.tsx / chat-info-content.tsx.
 *
 * The AI section only renders when the server reports suggestion capability
 * (useAiStatus()?.suggestions) — same gate the old sparkles button used, now
 * living here instead of at the entry point.
 */
export function SettingsContent({ showHeader = false, onClose, onBack, backLabel = "Back" }: SettingsContentProps) {
  const theme = useTheme();
  const nameOrder = useNameOrder();
  const suggestionMode = useSuggestionMode();
  const suggestionModel = useSuggestionModel();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          hitSlop={8}
          accessibilityLabel={backLabel}
          style={({ hovered, pressed }) => [styles.backBtn, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
        >
          {({ hovered, pressed }) => <>
            <Ionicons name="chevron-back" size={20} color={hovered || pressed ? theme.text : theme.accent} />
            <Text style={{ color: hovered || pressed ? theme.text : theme.accent, fontSize: 15 }}>{backLabel}</Text>
          </>}
        </Pressable>
      ) : (
        <Text style={[styles.paneHeaderTitle, { color: theme.text }]}>Settings</Text>
      )}
      {onClose && !onBack && (
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="Close settings"
          style={({ hovered, pressed }) => [styles.headerIcon, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
        >
          {({ hovered, pressed }) => <Ionicons name="close" size={20} color={hovered || pressed ? theme.text : theme.textSecondary} />}
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Names</Text>
          <View style={[styles.fieldGroup, { backgroundColor: theme.backgroundElement }]}>
            {NAME_ORDER_OPTIONS.map((opt, i) => (
              <ListRow
                key={opt.value}
                title={opt.label}
                titleWeight="400"
                onPress={() => setNameOrder(opt.value)}
                trailing={
                  nameOrder === opt.value ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : undefined
                }
                style={
                  i < NAME_ORDER_OPTIONS.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.divider,
                  }
                }
              />
            ))}
          </View>
          <Text style={[styles.fieldCaption, { color: theme.textSecondary }]}>
            Affects how names are sorted and shown in the Contacts list.
          </Text>
        </View>

        {aiStatus?.suggestions && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>AI</Text>
            <View style={[styles.fieldGroup, { backgroundColor: theme.backgroundElement }]}>
              {SUGGESTION_MODE_OPTIONS.map((opt, i) => (
                <ListRow
                  key={opt.value}
                  title={opt.label}
                  titleWeight="400"
                  onPress={() => setSuggestionMode(opt.value)}
                  trailing={
                    suggestionMode === opt.value ? (
                      <Ionicons name="checkmark" size={18} color={theme.accent} />
                    ) : undefined
                  }
                  style={
                    i < SUGGESTION_MODE_OPTIONS.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.divider,
                    }
                  }
                />
              ))}
            </View>
            <Text style={[styles.fieldCaption, { color: theme.textSecondary }]}>
              How reply suggestions appear in a conversation.
            </Text>

            <Text style={[styles.subsectionLabel, { color: theme.textSecondary }]}>Model</Text>
            <View style={[styles.fieldGroup, { backgroundColor: theme.backgroundElement }]}>
              {SUGGESTION_MODEL_OPTIONS.map((opt, i) => (
                <ListRow
                  key={opt.value}
                  title={opt.label}
                  subtitle={opt.detail}
                  titleWeight="400"
                  onPress={() => setSuggestionModel(opt.value)}
                  trailing={suggestionModel === opt.value ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : undefined}
                  style={i < SUGGESTION_MODEL_OPTIONS.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.divider,
                  }}
                />
              ))}
            </View>
            <Text style={[styles.fieldCaption, { color: theme.textSecondary }]}>
              If the selected route fails, Comma tries the other model and labels the shelf fallback.
            </Text>

            <View style={[styles.fieldGroup, styles.clearGroup, { backgroundColor: theme.backgroundElement }]}>
              <ListRow
                title={<Text style={{ color: "#ff453a", fontSize: 15 }}>Clear suggestion learning</Text>}
                titleWeight="400"
                onPress={() => showSheet({
                  title: "Clear suggestion learning?",
                  actions: [{
                    label: "Clear learning",
                    destructive: true,
                    onPress: () => void api.clearSuggestionLearning().then(
                      () => showToast("Suggestion learning cleared"),
                      () => showToast("Could not clear suggestion learning"),
                    ),
                  }],
                })}
              />
            </View>
          </View>
        )}
        <ReleaseIdentityFooter />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 58,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderTitle: { fontSize: 16, fontWeight: "600" },
  backBtn: { flexDirection: "row", alignItems: "center", borderRadius: 7, gap: 1, marginLeft: -4, paddingHorizontal: 4, paddingVertical: 3 },
  headerIcon: { alignItems: "center", borderRadius: 7, height: 28, justifyContent: "center", width: 28 },
  container: { padding: Spacing.three, paddingTop: Spacing.four },
  section: { width: "100%", marginBottom: Spacing.four },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  subsectionLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 8, marginTop: 18, paddingHorizontal: 6 },
  fieldGroup: { width: "100%", borderRadius: Radii.input, overflow: "hidden" },
  clearGroup: { marginTop: 18 },
  fieldCaption: { fontSize: 12, marginTop: 6, paddingHorizontal: 6 },
  releaseFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 5,
    marginTop: Spacing.two,
    paddingHorizontal: 6,
    paddingTop: Spacing.three,
  },
  releaseRow: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.three },
  releaseLabel: { fontSize: 11 },
  releaseValue: { fontFamily: Fonts.mono, fontSize: 11, textAlign: "right" },
});
