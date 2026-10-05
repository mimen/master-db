import { Ionicons } from "@expo/vector-icons";
import { displayReleaseSha } from "@shared/release-identity";
import type { SuggestionModel } from "@shared/types";
import { createContext, useContext, useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Dropdown, type DropdownOption } from "./ui/dropdown";

import { Fonts } from "@/constants/theme";
import { useAiStatus } from "@/hooks/use-ai";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { runCommand } from "@/lib/keyboard/controller";
import { shortcutFor } from "@/lib/keyboard/registry";
import { releaseStatus } from "@/lib/release-status";
import {
  setGroupBy,
  setNameOrder,
  setOpenOn,
  setSuggestionMode,
  setSuggestionModel,
  setTheme,
  useGroupBy,
  useNameOrder,
  useOpenOn,
  useSuggestionMode,
  useSuggestionModel,
  useThemePreference,
  type GroupConversationsBy,
  type NameOrder,
  type OpenOnLens,
  type SuggestionMode,
  type ThemePreference,
} from "@/lib/settings";
import { useSignalColors } from "@/lib/signal-colors";
import { showToast } from "@/lib/toast";

export interface SettingsContentProps {
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
  /** When set, the header shows a back chevron with this label instead of a close X. */
  onBack?: () => void;
  backLabel?: string;
}

const NAME_ORDER_OPTIONS: readonly DropdownOption<NameOrder>[] = [
  { value: "first-last", label: "First Last" },
  { value: "last-first", label: "Last, First" },
];

const OPEN_ON_OPTIONS: readonly DropdownOption<OpenOnLens>[] = [
  { value: "unresponded", label: "Needs reply" },
  { value: "unread", label: "Unread" },
  { value: "waiting", label: "Waiting" },
  { value: "all", label: "All" },
];

const GROUP_BY_OPTIONS: readonly DropdownOption<GroupConversationsBy>[] = [
  { value: "last-message", label: "Last message" },
  { value: "person", label: "Person" },
  { value: "none", label: "None" },
];

const SUGGESTION_MODE_OPTIONS: readonly DropdownOption<SuggestionMode>[] = [
  { value: "off", label: "Off" },
  { value: "on-demand", label: "On demand" },
  { value: "auto", label: "Automatic" },
];

const SUGGESTION_MODEL_OPTIONS: readonly DropdownOption<SuggestionModel>[] = [
  { value: "opus", label: "Opus", detail: "Claude", description: "Claude. Best at tone and long threads." },
  { value: "terra", label: "Terra", detail: "ChatGPT", description: "ChatGPT. Faster on short replies." },
];

const THEME_OPTIONS: readonly DropdownOption<ThemePreference>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const FIELD_WIDTH = 196;

/** One version line; the full release identity is a click away for debugging. */
function ReleaseIdentityFooter(): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  const [expanded, setExpanded] = useState(false);
  const snapshot = useSyncExternalStore(
    releaseStatus.subscribe,
    releaseStatus.getSnapshot,
    releaseStatus.getSnapshot,
  );
  const { environment, branch, webSha } = snapshot.running;
  const rows = [
    ["Environment", environment],
    ["Branch", branch ?? "None"],
    ["Running web", displayReleaseSha(webSha)],
    ["Deployed web", displayReleaseSha(snapshot.deployedWeb?.webSha ?? null)],
    ["Running shell", displayReleaseSha(snapshot.shell.runningSha)],
    ["Staged shell", displayReleaseSha(snapshot.shell.stagedSha)],
  ] as const;
  const version = webSha ? displayReleaseSha(webSha) : "local build";
  const qualifier = environment === "production" || !webSha ? "" : ` on ${branch ?? environment}`;

  return (
    <View style={styles.releaseFooter}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide release details" : "Show release details"}
        aria-expanded={expanded}
        onPress={() => setExpanded((current) => !current)}
        style={styles.versionLine}
      >
        {({ hovered, pressed }) => (
          <Text style={[styles.versionText, { color: hovered || pressed ? theme.text : theme.textSecondary }]}>
            {"Version "}
            <Text style={[styles.versionValue, { color: theme.text }]}>{version}</Text>
            {`${qualifier}. ${expanded ? "Click to hide release details." : "Click for release details."}`}
          </Text>
        )}
      </Pressable>
      {expanded && (
        <View style={styles.releaseDetails} testID="release-identity-footer">
          {rows.map(([label, value]) => (
            <View key={label} style={styles.releaseRow}>
              <Text style={[styles.releaseLabel, { color: signal.tertiary }]}>{label}</Text>
              <Text selectable style={[styles.releaseLabel, styles.releaseValue, { color: theme.textSecondary }]}>{value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  return (
    <View style={styles.group}>
      <Text role="heading" style={[styles.groupTitle, { color: theme.text }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: signal.surface, borderColor: signal.divider }]}>{children}</View>
    </View>
  );
}

/** Below this pane width a row stacks its field under the label. */
const INLINE_MIN_WIDTH = 480;
const InlineContext = createContext(false);

function SettingRow({ title, caption, first = false, children }: { title: string; caption?: string; first?: boolean; children: ReactNode }): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  const inline = useContext(InlineContext);
  return (
    <View style={[styles.row, !inline && styles.rowStacked, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: signal.divider }]}>
      <View style={styles.rowLabel}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
        {caption && <Text style={[styles.rowCaption, { color: signal.tertiary }]}>{caption}</Text>}
      </View>
      <View style={inline ? { width: FIELD_WIDTH } : styles.fieldStacked}>{children}</View>
    </View>
  );
}

/**
 * The app's one settings surface: grouped cards where every choice is a
 * Dropdown. Follows the shared-content contract (showHeader/onClose/onBack) so
 * one component serves the phone /settings modal and the desktop pane.
 *
 * Reply suggestions render only when the server reports suggestion capability.
 */
export function SettingsContent({ showHeader = false, onClose, onBack, backLabel = "Back" }: SettingsContentProps): JSX.Element {
  const theme = useTheme();
  const signal = useSignalColors();
  const { wide } = useLayoutMode();
  const nameOrder = useNameOrder();
  const openOn = useOpenOn();
  const groupBy = useGroupBy();
  const suggestionMode = useSuggestionMode();
  const suggestionModel = useSuggestionModel();
  const themePreference = useThemePreference();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();
  const keyboard = Platform.OS === "web" && wide;
  const [inline, setInline] = useState(false);

  const clearLearning = (): void => showSheet({
    title: "Clear suggestion learning?",
    actions: [{
      label: "Clear learning",
      destructive: true,
      onPress: () => void api.clearSuggestionLearning().then(
        () => showToast("Suggestion learning cleared"),
        () => showToast("Couldn't clear suggestion learning. Try again."),
      ),
    }],
  });

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: signal.divider }]}>
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
        <Text role="heading" style={[styles.paneHeaderTitle, { color: theme.text }]}>Settings</Text>
      )}
      {onClose && !onBack && (
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="Close settings"
          style={({ hovered, pressed }) => [styles.headerIcon, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
        >
          {({ hovered, pressed }) => <Ionicons name="close" size={20} color={hovered || pressed ? theme.text : signal.icon} />}
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: signal.background }}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        onLayout={(event) => setInline(event.nativeEvent.layout.width >= INLINE_MIN_WIDTH)}
        contentContainerStyle={[styles.container, inline && styles.containerWide]}
      >
        <InlineContext value={inline}>
        <View style={styles.column}>
          <Group title="Names">
            <SettingRow first title="Name order" caption="How people appear in the list, the palette and notifications.">
              <Dropdown label="Name order" value={nameOrder} options={NAME_ORDER_OPTIONS} onChange={setNameOrder} />
            </SettingRow>
          </Group>

          <Group title="Lists">
            <SettingRow first title="Open on" caption="The lens Comma shows when it starts.">
              <Dropdown label="Open on" value={openOn} options={OPEN_ON_OPTIONS} onChange={setOpenOn} />
            </SettingRow>
            <SettingRow title="Group conversations by" caption="Section headers in every lens.">
              <Dropdown label="Group conversations by" value={groupBy} options={GROUP_BY_OPTIONS} onChange={setGroupBy} />
            </SettingRow>
          </Group>

          {aiStatus?.suggestions && (
            <Group title="Reply suggestions">
              <SettingRow first title="Suggest replies" caption="Automatic writes a ghost reply as you open a conversation. On demand waits for Tab.">
                <Dropdown label="Suggest replies" value={suggestionMode} options={SUGGESTION_MODE_OPTIONS} onChange={setSuggestionMode} />
              </SettingRow>
              <SettingRow title="Model" caption="Used for suggestions. Comma falls back to the other model if this one is unavailable.">
                <Dropdown label="Model" value={suggestionModel} options={SUGGESTION_MODEL_OPTIONS} onChange={setSuggestionModel} menuWidth={256} />
              </SettingRow>
              <SettingRow title="Suggestion learning">
                <Pressable
                  accessibilityRole="button"
                  onPress={clearLearning}
                  style={({ hovered, pressed }) => [styles.quietButton, (hovered || pressed) && { backgroundColor: theme.backgroundElement }]}
                >
                  <Text style={[styles.quietButtonText, { color: signal.danger }]}>Clear suggestion learning</Text>
                </Pressable>
              </SettingRow>
            </Group>
          )}

          <Group title="Appearance">
            <SettingRow first title="Theme">
              <Dropdown label="Theme" value={themePreference} options={THEME_OPTIONS} onChange={setTheme} />
            </SettingRow>
          </Group>

          {keyboard && (
            <Group title="Keyboard">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View keyboard shortcuts"
                onPress={() => runCommand("help.open", "button")}
                style={({ hovered, pressed }) => [styles.row, styles.linkRow, (hovered || pressed) && { backgroundColor: theme.backgroundElement }]}
              >
                <View style={styles.rowLabel}>
                  <Text style={[styles.rowTitle, { color: theme.text }]}>Keyboard shortcuts</Text>
                  <Text style={[styles.rowCaption, { color: signal.tertiary }]}>Every shortcut, including J and K to move and ⌘E to settle.</Text>
                </View>
                <View style={styles.link}>
                  <Text style={[styles.linkText, { color: theme.textSecondary }]}>View shortcuts</Text>
                  <Text style={[styles.kbd, { color: theme.textSecondary, borderColor: signal.fieldBorder }]}>{shortcutFor("help.open")}</Text>
                  <Ionicons name="chevron-forward" size={15} color={signal.icon} />
                </View>
              </Pressable>
            </Group>
          )}

          <ReleaseIdentityFooter />
        </View>
        </InlineContext>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderTitle: { fontSize: 15, fontWeight: "600" },
  backBtn: { flexDirection: "row", alignItems: "center", borderRadius: 7, gap: 1, marginLeft: -4, paddingHorizontal: 4, paddingVertical: 3 },
  headerIcon: { alignItems: "center", borderRadius: 7, height: 28, justifyContent: "center", width: 28 },
  container: { paddingHorizontal: 16, paddingVertical: 20 },
  containerWide: { paddingHorizontal: 32, paddingVertical: 28 },
  column: { width: "100%", maxWidth: 576, alignSelf: "center" },
  group: { marginBottom: 18 },
  groupTitle: { fontSize: 13.5, fontWeight: "600", letterSpacing: -0.1, marginHorizontal: 4, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 24, minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 },
  rowStacked: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  rowLabel: { flex: 1 },
  rowTitle: { fontSize: 13.5 },
  rowCaption: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  fieldStacked: { alignSelf: "stretch" },
  quietButton: { alignSelf: "flex-start", borderRadius: 7, marginLeft: -8, paddingHorizontal: 8, paddingVertical: 5 },
  quietButtonText: { fontSize: 13 },
  linkRow: { cursor: "pointer" } as const,
  link: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { fontSize: 13 },
  kbd: { fontSize: 11, borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  releaseFooter: { marginTop: 4, marginHorizontal: 4 },
  versionLine: { alignSelf: "flex-start", paddingVertical: 4 },
  versionText: { fontSize: 12 },
  versionValue: { fontWeight: "500", fontVariant: ["tabular-nums"] },
  releaseDetails: { gap: 5, marginTop: 8 },
  releaseRow: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  releaseLabel: { fontSize: 11 },
  releaseValue: { fontFamily: Fonts.mono },
});
