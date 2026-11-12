import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatAddress, parseHandle } from "@shared/address";
import { settleActionFor } from "@shared/chat-state";
import { conversationRoute, dmAddress } from "@shared/imessage";
import { platformBadge } from "@shared/platform-profile";
import type { ChatSummary, ConversationId } from "@shared/types";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useConversation } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { toggleSettleChat } from "@/hooks/use-triage-actions";
import { ChatAvatar, PersonAvatar } from "@/components/avatar";
import { EmailReader, ThreadView } from "@/components/lazy-surfaces";
import { useFaceTimeActions } from "@/components/facetime-button";
import { UnavailableState } from "@/components/empty-state";
import { BackButton } from "@/components/ui/back-button";
import { useActionSheet } from "@/lib/action-sheet";
import { SourceIcon } from "@/components/service-label";
import { openAgentPane } from "@/lib/agent-pane";
import { openThreadSearch } from "@/lib/thread-search";
import { goBackOrHome } from "@/lib/back-navigation";
import type { JumpTarget } from "@/hooks/use-messages";

function HeaderTitle({ chat, maxWidth }: { chat: ChatSummary | null | undefined; maxWidth: number }) {
  const theme = useTheme();
  const address = chat ? dmAddress(chat) : null;
  // A Slack user id reads as nothing; the glyph says Slack.
  const shownAddress = address && parseHandle(address)?.kind !== "slack" ? formatAddress(address) : null;
  return (
    <View style={[headerStyles.container, { maxWidth }]}>
      {chat ? <ChatAvatar chat={chat} size={32} /> : <PersonAvatar address={null} name="" size={32} />}
      <View style={headerStyles.identityText}>
        <View style={headerStyles.nameRow}>
          <Text numberOfLines={1} style={[headerStyles.name, { color: theme.text }]}>
            {chat?.displayName ?? ""}
          </Text>
          {chat ? <SourceIcon badge={platformBadge(conversationRoute(chat))} size={14} /> : null}
        </View>
        {chat?.isGroup && !chat.subject && chat.participants.length > 0 && (
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{chat.participants.length} people</Text>
        )}
        {/* An email thread's second line is its subject. */}
        {(chat?.subject || shownAddress) && (
          <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 11 }}>{chat?.subject || shownAddress}</Text>
        )}
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  identityText: {
    flexShrink: 1,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  name: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
  },
});

/** Archive is Mail's settle. It answers with its toast and Undo, and returns to the list the thread left. */
function MailArchive({ chat }: { chat: ChatSummary }) {
  const theme = useTheme();
  const settled = settleActionFor(chat) === "unsettle";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={settled ? "Move to Inbox" : "Archive"}
      onPress={() => {
        void toggleSettleChat(chat);
        if (!settled) goBackOrHome(router);
      }}
      hitSlop={8}
    >
      <Ionicons name={settled ? "arrow-undo-circle-outline" : "archive-outline"} size={24} color={theme.accent} />
    </Pressable>
  );
}

export default function ChatScreen(): React.JSX.Element | null {
  const params = useLocalSearchParams<{
    conversationId: ConversationId;
    targetGuid?: string;
    targetDate?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const theme = useTheme();
  const showSheet = useActionSheet();
  const { wide, width } = useLayoutMode();
  const agentEnabled = useAgentEnabled();
  const chat = useConversation(params.conversationId);
  const faceTime = useFaceTimeActions({
    conversationId: params.conversationId,
    isGroup: chat?.isGroup ?? false,
    address: chat ? dmAddress(chat) : null,
  });
  const jumpTarget: JumpTarget | null =
    params.targetGuid && params.targetDate
      ? { guid: params.targetGuid, dateCreated: Number(params.targetDate) }
      : null;
  if (wide) return null;
  if (chat === null) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: "", headerLeft: () => <BackButton />, headerRight: () => null }} />
        <UnavailableState onBack={() => goBackOrHome(router)} />
      </>
    );
  }
  const mail = chat?.route.platform === "gmail";
  // Room left of the action pill: ~70pt for the back button, ~44pt per action, ~32pt of pill padding.
  const titleMaxWidth = width - 70 - ((agentEnabled ? 1 : 0) + (mail ? 1 : 2)) * 44 - 32;
  const openMore = () => showSheet({ actions: [{ label: "Search conversation", onPress: () => openThreadSearch() }, ...faceTime] });

  return (
    <>
      <Stack.Screen
        options={{
          headerTitleAlign: "left",
          headerLeft: () => <BackButton />,
          headerTitle: () => <HeaderTitle chat={chat} maxWidth={titleMaxWidth} />,
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 6 }}>
              {agentEnabled ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Ask the agent" onPress={() => openAgentPane(params.conversationId)} hitSlop={8}>
                  <Ionicons name="sparkles-outline" size={22} color={theme.accent} />
                </Pressable>
              ) : null}
              {mail && chat ? <MailArchive chat={chat} /> : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Details"
                    onPress={() => router.push({ pathname: "/chat-info", params: { conversation: params.conversationId } })}
                    hitSlop={8}
                  >
                    <Ionicons name="information-circle-outline" size={26} color={theme.accent} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={openMore} hitSlop={8}>
                    <Ionicons name="ellipsis-horizontal-circle-outline" size={26} color={theme.accent} />
                  </Pressable>
                </>
              )}
            </View>
          ),
        }}
      />
      {/* An email thread reads in the Mail reader, under the same header a message thread has. */}
      {mail ? <EmailReader key={params.conversationId} conversationId={params.conversationId} phone /> : (
        <ThreadView
          conversationId={params.conversationId}
          isGroup={chat?.isGroup ?? false}
          jumpTarget={jumpTarget}
          headerOffset={headerHeight}
        />
      )}
    </>
  );
}
