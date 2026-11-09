import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatAddress, parseHandle } from "@shared/address";
import { conversationRoute, dmAddress } from "@shared/imessage";
import { platformBadge } from "@shared/platform-profile";
import type { ChatSummary, ConversationId } from "@shared/types";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useConversation } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { ChatAvatar, PersonAvatar } from "@/components/avatar";
import { ThreadView } from "@/components/lazy-surfaces";
import { FaceTimeButton } from "@/components/facetime-button";
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
        {chat?.isGroup && chat.participants.length > 0 && (
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{chat.participants.length} people</Text>
        )}
        {shownAddress && (
          <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 11 }}>{shownAddress}</Text>
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

export default function ChatScreen(): React.JSX.Element | null {
  const params = useLocalSearchParams<{
    conversationId: ConversationId;
    targetGuid?: string;
    targetDate?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const theme = useTheme();
  const { wide, width } = useLayoutMode();
  const agentEnabled = useAgentEnabled();
  const chat = useConversation(params.conversationId);
  const jumpTarget: JumpTarget | null =
    params.targetGuid && params.targetDate
      ? { guid: params.targetGuid, dateCreated: Number(params.targetDate) }
      : null;
  if (wide) return null;
  // An email Today ranks reads in the Mail reader.
  if (chat?.route.platform === "gmail") return <Redirect href={{ pathname: "/mail", params: { thread: chat.conversationId } }} />;
  // Room left of the action pill: ~70pt for the back button, ~44pt per action, ~32pt of pill padding.
  const titleMaxWidth = width - 70 - (agentEnabled ? 4 : 3) * 44 - 32;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitleAlign: "left",
          headerLeft: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBackOrHome(router)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="chevron-back" size={26} color={theme.accent} />
            </Pressable>
          ),
          headerTitle: () => <HeaderTitle chat={chat} maxWidth={titleMaxWidth} />,
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 6 }}>
              <FaceTimeButton
                conversationId={params.conversationId}
                isGroup={chat?.isGroup ?? false}
                address={chat ? dmAddress(chat) : null}
                color={theme.accent}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Search conversation" onPress={() => openThreadSearch()} hitSlop={8}>
                <Ionicons name="search" size={22} color={theme.accent} />
              </Pressable>
              {agentEnabled ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Ask the agent" onPress={() => openAgentPane(params.conversationId)} hitSlop={8}>
                  <Ionicons name="sparkles-outline" size={22} color={theme.accent} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Details"
                onPress={() => router.push({ pathname: "/chat-info", params: { conversation: params.conversationId } })}
                hitSlop={8}
              >
                <Ionicons name="information-circle-outline" size={26} color={theme.accent} />
              </Pressable>
            </View>
          ),
        }}
      />
      <ThreadView
        conversationId={params.conversationId}
        isGroup={chat?.isGroup ?? false}
        jumpTarget={jumpTarget}
        headerOffset={headerHeight}
      />
    </>
  );
}
