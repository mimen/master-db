import Ionicons from "@expo/vector-icons/Ionicons";
import { displayReleaseSha } from "@shared/release-identity";
import type { SuggestionModel } from "@shared/types";
import type { api as convexApi } from "@convex-api";
import type { AccountId } from "@shared/types";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { anyApi, type FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { Dropdown, type DropdownOption } from "./ui/dropdown";

import { Fonts } from "@/constants/theme";
import { useAiStatus } from "@/hooks/use-ai";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { TriageGeometry } from "@/constants/triage-theme";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { grantEnded, reconnectCaption } from "@/lib/gmail-grant";
import { convexClient } from "@/lib/identity";
import { runCommand } from "@/lib/keyboard/controller";
import { shortcutFor } from "@/lib/keyboard/registry";
import { releaseStatus } from "@/lib/release-status";
import type { AgentEffort } from "@/lib/agent-api";
import { AGENT_EFFORTS, AGENT_MODELS } from "@/lib/agent-models";
import {
  setAgentSettings,
  setGroupBy,
  setNameOrder,
  setOpenOn,
  setSuggestionMode,
  setSuggestionModel,
  setTheme,
  useAgentSettings,
  useGroupBy,
  useNameOrder,
  useOpenOn,
  useSuggestionMode,
  useSuggestionModel,
  useThemePreference,
  type AgentModel,
  type GroupConversationsBy,
  type NameOrder,
  type OpenOnLens,
  type SuggestionMode,
  type ThemePreference,
} from "@/lib/settings";
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
  { value: "unresponded", label: "Needs you" },
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

const AGENT_PANE_OPTIONS: readonly DropdownOption<"on" | "off">[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const AGENT_MODEL_OPTIONS: readonly DropdownOption<AgentModel>[] = AGENT_MODELS.map((model) => ({ value: model.id, label: model.label }));
const AGENT_EFFORT_OPTIONS: readonly DropdownOption<AgentEffort>[] = AGENT_EFFORTS.map((effort) => ({ value: effort.id, label: effort.label }));

const FIELD_WIDTH = 196;

/** One version line; the full release identity is a click away for debugging. */
function ReleaseIdentityFooter(): JSX.Element {
  const theme = useTheme();
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
              <Text style={[styles.releaseLabel, { color: theme.textTertiary }]}>{label}</Text>
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
  return (
    <View style={styles.group}>
      <Text role="heading" style={[styles.groupTitle, { color: theme.text }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.divider }]}>{children}</View>
    </View>
  );
}

const accountsApi = anyApi.comma.accounts as unknown as typeof convexApi.comma.accounts;
const slackAuthApi = anyApi.comma.slackAuth as unknown as typeof convexApi.comma.slackAuth;
const slackChannelsApi = anyApi.comma.slackChannels as unknown as typeof convexApi.comma.slackChannels;
type SlackChannel = { id: string; name: string; isPrivate: boolean; following: boolean };

/**
 * The channels Milad is in, each with whether Comma follows it. Following one reads its last 90 days; a channel
 * wants Milad only when someone mentions him, and its threads only once he is in them.
 */
function SlackChannels({ accountId }: { accountId: AccountId }): JSX.Element {
  const theme = useTheme();
  const listSlackChannels = useAction(slackChannelsApi.listSlackChannels);
  const [channels, setChannels] = useState<SlackChannel[] | "failed" | null>(null);
  useEffect(() => {
    let live = true;
    listSlackChannels({ accountId }).then((list) => {
      if (live) setChannels([...list].sort((a, b) => Number(b.following) - Number(a.following)));
    }, () => live && setChannels("failed"));
    return () => {
      live = false;
    };
  }, [accountId, listSlackChannels]);
  const follow = (channel: SlackChannel, following: boolean): void => {
    const set = (value: boolean) => setChannels((list) => Array.isArray(list) ? list.map((row) => row.id === channel.id ? { ...row, following: value } : row) : list);
    set(following);
    convexClient.mutation(slackChannelsApi.setSlackChannel, { accountId, channel: channel.id, name: channel.name, following }).catch(() => {
      set(!following);
      showToast(`Couldn't ${following ? "follow" : "stop following"} #${channel.name}. Try again.`);
    });
  };
  const caption = channels === "failed" ? "Couldn't read your channels from Slack."
    : "Comma keeps the channels you follow, and asks for you only when someone mentions you.";
  return (
    <>
      <SettingRow title="Channels" caption={channels === null ? "Reading your channels from Slack…" : caption}>{null}</SettingRow>
      {Array.isArray(channels) && channels.map((channel) => (
        <SettingRow key={channel.id} title={`#${channel.name}`} caption={channel.isPrivate ? "Private" : undefined}>
          <Switch
            accessibilityLabel={`Follow #${channel.name}`}
            value={channel.following}
            onValueChange={(value) => follow(channel, value)}
            trackColor={{ true: theme.accent, false: theme.divider }}
            thumbColor="#ffffff"
          />
        </SettingRow>
      ))}
    </>
  );
}
const googleAuthApi = anyApi.comma.googleAuth as unknown as typeof convexApi.comma.googleAuth;

function QuietButton({ label, accessibilityLabel, destructive = false, onPress }: {
  label: string; accessibilityLabel?: string; destructive?: boolean; onPress: () => void;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ hovered, pressed }) => [styles.quietButton, (hovered || pressed) && { backgroundColor: theme.backgroundElement }]}
    >
      <Text style={[styles.quietButtonText, { color: destructive ? theme.destructive : theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

type Account = FunctionReturnType<typeof accountsApi.listAccounts>[number];

/** One OAuth account's row: Connect opens the platform's consent in a browser tab; a token Google refused shows Reconnect. */
function OAuthAccountRow({ first, name, account, about, reading, start, stop }: {
  first: boolean; name: string; account: Account | undefined; about: string; reading: string;
  start: () => Promise<string>; stop: (accountId: AccountId) => Promise<null>;
}): JSX.Element {
  const showSheet = useActionSheet();
  const connect = (): void => void start().then(
    (url) => Linking.openURL(url),
    () => showToast(`Couldn't start connecting ${name}. Try again.`),
  );
  const disconnect = (accountId: AccountId): void => showSheet({
    title: `Disconnect ${name}? Comma stops reading it until you reconnect.`,
    actions: [{
      label: "Disconnect",
      destructive: true,
      onPress: () => void stop(accountId).then(
        () => showToast(`${name} disconnected`),
        () => showToast(`Couldn't disconnect ${name}. Try again.`),
      ),
    }],
  });
  const now = Date.now();
  const ended = grantEnded(account?.reconnectBy, now);
  const live = account?.connected && account.health === "ok" && !ended;
  const countdown = account?.reconnectBy !== undefined ? ` ${reconnectCaption(account.reconnectBy, now)}` : "";
  const caption = live ? `${account.label}. ${reading}${countdown}`
    : account?.connected ? `${account.label}.${ended ? countdown : ` ${name} stopped answering. Reconnect to keep reading.`}`
      : account ? `${account.label}. Not connected.` : about;
  return (
    <SettingRow first={first} title={name} caption={caption}>
      {live
        ? <QuietButton label="Disconnect" accessibilityLabel={`Disconnect ${name}`} destructive onPress={() => disconnect(account._id)} />
        : <QuietButton label={account ? "Reconnect" : "Connect"} accessibilityLabel={`${account ? "Reconnect" : "Connect"} ${name}`} onPress={connect} />}
    </SettingRow>
  );
}

/** Each signed-in account and its connection. Slack and Gmail connect through OAuth in a browser tab. */
function AccountsGroup(): JSX.Element | null {
  const { isAuthenticated } = useConvexAuth();
  const accounts = useQuery(accountsApi.listAccounts, isAuthenticated ? {} : "skip");
  const startSlackConnect = useAction(slackAuthApi.startSlackConnect);
  const disconnectSlack = useAction(slackAuthApi.disconnectSlack);
  const startGmailConnect = useAction(googleAuthApi.startGmailConnect);
  const disconnectGmail = useAction(googleAuthApi.disconnectGmail);
  const theme = useTheme();
  if (!accounts) return null;
  const imessage = accounts.find((account) => account.platform === "imessage");
  const slack = accounts.find((account) => account.platform === "slack");
  return (
    <Group title="Accounts">
      {imessage && (
        <SettingRow first title="iMessage" caption="Through the Mac mini.">
          <Text style={[styles.rowCaption, { color: theme.textSecondary }]}>Connected</Text>
        </SettingRow>
      )}
      <OAuthAccountRow
        first={!imessage}
        name="Slack"
        account={slack}
        about="Read your AUF DMs, group DMs and threads in Comma."
        reading="Comma reads your DMs, group DMs, threads and the channels you follow."
        start={() => startSlackConnect({})}
        stop={(accountId) => disconnectSlack({ accountId })}
      />
      {slack?.connected ? <SlackChannels accountId={slack._id} /> : null}
      <OAuthAccountRow
        first={false}
        name="Gmail"
        account={accounts.find((account) => account.platform === "gmail" && account.gmailApp !== "personal")}
        about="Read your AUF mailbox in Comma's Mail."
        reading="Comma reads your inbox, and replies, forwards and archives from it."
        start={() => startGmailConnect({})}
        stop={(accountId) => disconnectGmail({ accountId })}
      />
      <OAuthAccountRow
        first={false}
        name="Personal Gmail"
        account={accounts.find((account) => account.platform === "gmail" && account.gmailApp === "personal")}
        about="Read your gmail.com mailbox in Comma's Mail. Google asks you to reconnect it every week."
        reading="Comma reads your inbox."
        start={() => startGmailConnect({ app: "personal" })}
        stop={(accountId) => disconnectGmail({ accountId })}
      />
    </Group>
  );
}

/** Below this pane width a row stacks its field under the label. */
const INLINE_MIN_WIDTH = 480;
const InlineContext = createContext(false);

function SettingRow({ title, caption, first = false, children }: { title: string; caption?: string; first?: boolean; children: ReactNode }): JSX.Element {
  const theme = useTheme();
  const inline = useContext(InlineContext);
  return (
    <View style={[styles.row, !inline && styles.rowStacked, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}>
      <View style={styles.rowLabel}>
        <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
        {caption && <Text style={[styles.rowCaption, { color: theme.textTertiary }]}>{caption}</Text>}
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
  const { wide } = useLayoutMode();
  const nameOrder = useNameOrder();
  const openOn = useOpenOn();
  const groupBy = useGroupBy();
  const suggestionMode = useSuggestionMode();
  const suggestionModel = useSuggestionModel();
  const themePreference = useThemePreference();
  const agent = useAgentSettings();
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
          {({ hovered, pressed }) => <Ionicons name="close" size={20} color={hovered || pressed ? theme.text : theme.icon} />}
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.thread }}>
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

          <AccountsGroup />

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
                  <Text style={[styles.quietButtonText, { color: theme.destructive }]}>Clear suggestion learning</Text>
                </Pressable>
              </SettingRow>
            </Group>
          )}

          {aiStatus.agentAvailable && (
            <Group title="Agent">
              <SettingRow first title="Agent pane" caption="Ask about the open conversation with ⌘J. The agent drafts replies; it sends only when you tell it to.">
                <Dropdown label="Agent pane" value={agent.agentPane ? "on" : "off"} options={AGENT_PANE_OPTIONS} onChange={(value) => setAgentSettings({ agentPane: value === "on" })} />
              </SettingRow>
              <SettingRow title="Model" caption="What a new chat starts with. Switch it for one chat from the pane's input.">
                <Dropdown label="Agent model" value={agent.agentModel} options={AGENT_MODEL_OPTIONS} onChange={(agentModel) => setAgentSettings({ agentModel })} />
              </SettingRow>
              <SettingRow title="Effort" caption="Higher effort thinks longer before it answers.">
                <Dropdown label="Agent effort" value={agent.agentEffort} options={AGENT_EFFORT_OPTIONS} onChange={(agentEffort) => setAgentSettings({ agentEffort })} />
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
                  <Text style={[styles.rowCaption, { color: theme.textTertiary }]}>Every shortcut, including J and K to move and ⌘E to settle.</Text>
                </View>
                <View style={styles.link}>
                  <Text style={[styles.linkText, { color: theme.textSecondary }]}>View shortcuts</Text>
                  <Text style={[styles.kbd, { color: theme.textSecondary, borderColor: theme.dividerStrong }]}>{shortcutFor("help.open")}</Text>
                  <Ionicons name="chevron-forward" size={15} color={theme.icon} />
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
    height: TriageGeometry.threadHeaderHeight,
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
