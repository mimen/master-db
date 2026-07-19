import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useTheme } from "@/hooks/use-theme";
import type { PrototypeChat, PrototypeDesignProps, PrototypeLens, PrototypeMessage } from "../types";

const DESKTOP_BREAKPOINT = 768;

const FILTERS: readonly { id: PrototypeLens; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { id: "all", label: "All", icon: "chatbubble-outline" },
  { id: "reply", label: "Needs you", icon: "return-up-back" },
  { id: "unread", label: "Unread", icon: "ellipse" },
  { id: "waiting", label: "Waiting", icon: "hourglass-outline" },
  { id: "groups", label: "Groups", icon: "people-outline" },
];

function matchesFilter(chat: PrototypeChat, filter: PrototypeLens, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery =
    normalizedQuery.length === 0 ||
    chat.name.toLocaleLowerCase().includes(normalizedQuery) ||
    chat.preview.toLocaleLowerCase().includes(normalizedQuery);

  if (!matchesQuery) return false;
  if (filter === "reply") return chat.attention === "reply";
  if (filter === "unread") return chat.unreadCount > 0;
  if (filter === "waiting") return chat.attention === "waiting";
  if (filter === "groups") return chat.isGroup;
  return true;
}

function Avatar({ chat, size = 48 }: { chat: PrototypeChat; size?: number }): React.JSX.Element {
  if (chat.isGroup) {
    return (
      <View style={[styles.groupAvatar, { width: size, height: size }]}>
        <View
          style={[
            styles.groupAvatarCircle,
            {
              width: size * 0.68,
              height: size * 0.68,
              borderRadius: size * 0.34,
              backgroundColor: chat.avatarColor,
              opacity: 0.72,
              right: 0,
              top: 0,
            },
          ]}
        />
        <View
          style={[
            styles.groupAvatarCircle,
            {
              width: size * 0.68,
              height: size * 0.68,
              borderRadius: size * 0.34,
              backgroundColor: chat.avatarColor,
              left: 0,
              bottom: 0,
            },
          ]}
        >
          <Text style={[styles.avatarInitials, { fontSize: size * 0.26 }]}>{chat.initials}</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: chat.avatarColor },
      ]}
    >
      <Text style={[styles.avatarInitials, { fontSize: size * 0.34 }]}>{chat.initials}</Text>
    </View>
  );
}

function ShelfItem({
  chat,
  selected,
  onPress,
}: {
  chat: PrototypeChat;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const label = chat.attention === "waiting" ? "Waiting" : chat.unreadCount > 0 ? `${chat.unreadCount} new` : "Reply";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${chat.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.shelfItem, { opacity: pressed ? 0.62 : 1 }]}
    >
      <View style={styles.shelfAvatarWrap}>
        <Avatar chat={chat} size={58} />
        <View style={[styles.shelfStatus, { backgroundColor: selected ? theme.accent : theme.background, borderColor: theme.background }]}>
          <Ionicons
            name={chat.attention === "waiting" ? "hourglass" : "return-up-back"}
            size={10}
            color={selected ? "#FFFFFF" : theme.accent}
          />
        </View>
      </View>
      <Text numberOfLines={1} style={[styles.shelfName, { color: theme.text }]}>
        {chat.name}
      </Text>
      <Text numberOfLines={1} style={[styles.shelfMeta, { color: theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ConversationRow({
  chat,
  selected,
  onPress,
}: {
  chat: PrototypeChat;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${chat.name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.conversationRow,
        {
          backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : theme.background,
          borderBottomColor: theme.divider,
        },
      ]}
    >
      <View style={styles.unreadColumn}>{chat.unreadCount > 0 && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}</View>
      <Avatar chat={chat} size={52} />
      <View style={styles.rowCopy}>
        <View style={styles.rowHeadline}>
          <Text numberOfLines={1} style={[styles.rowName, { color: theme.text, fontWeight: chat.unreadCount > 0 ? "700" : "600" }]}>
            {chat.name}
          </Text>
          <Text style={[styles.rowTime, { color: theme.textSecondary }]}>{chat.time}</Text>
        </View>
        <View style={styles.previewLine}>
          <Text
            numberOfLines={2}
            style={[styles.rowPreview, { color: theme.textSecondary, fontWeight: chat.unreadCount > 0 ? "500" : "400" }]}
          >
            {chat.preview}
          </Text>
          {chat.unreadCount > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
              <Text style={styles.unreadBadgeText}>{chat.unreadCount > 9 ? "9+" : chat.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function Thread({ chat, messages, onBack }: { chat: PrototypeChat; messages: readonly PrototypeMessage[]; onBack?: () => void }): React.JSX.Element {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const threadMessages = messages.filter((message) => message.chatId === chat.id);

  return (
    <KeyboardAvoidingView
      style={[styles.thread, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" && onBack ? "padding" : undefined}
    >
      <View style={[styles.threadHeader, { borderBottomColor: theme.divider }]}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations" onPress={onBack} hitSlop={10} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={theme.accent} />
            <Text style={[styles.backLabel, { color: theme.accent }]}>Messages</Text>
          </Pressable>
        ) : (
          <View style={styles.desktopHeaderSpacer} />
        )}
        <View style={styles.threadContact}>
          <Avatar chat={chat} size={32} />
          <View style={styles.threadContactCopy}>
            <Text numberOfLines={1} style={[styles.threadName, { color: theme.text }]}>{chat.name}</Text>
            <Text style={[styles.threadStatus, { color: theme.textSecondary }]}>
              {chat.isGroup ? `${chat.participants} people` : "iMessage"}
            </Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Info for ${chat.name}`} hitSlop={10} style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={25} color={theme.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.messageScroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>Today</Text>
        {threadMessages.map((message) => (
          <View key={message.id} style={[styles.messageRow, message.fromMe ? styles.messageRowMine : styles.messageRowTheirs]}>
            {!message.fromMe && chat.isGroup && message.sender ? (
              <Text style={[styles.senderName, { color: theme.textSecondary }]}>{message.sender}</Text>
            ) : null}
            <View style={[styles.bubble, message.fromMe ? { backgroundColor: theme.bubbleMine } : { backgroundColor: theme.bubbleTheirs }]}>
              <Text style={[styles.bubbleText, { color: message.fromMe ? "#FFFFFF" : theme.bubbleTheirsText }]}>{message.text}</Text>
            </View>
            <View style={styles.messageMeta}>
              <Text style={[styles.messageTime, { color: theme.textSecondary }]}>{message.time}</Text>
              {message.reaction ? <Text style={styles.reaction}>{message.reaction}</Text> : null}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" style={[styles.composeAction, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="add" size={24} color={theme.accent} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="iMessage"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.composeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={draft.trim().length === 0}
          onPress={() => setDraft("")}
          style={({ pressed }) => [styles.sendButton, { opacity: draft.trim().length === 0 || pressed ? 0.35 : 1 }]}
        >
          <Ionicons name="arrow-up-circle" size={32} color={theme.accent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Inbox({
  chats,
  selectedChatId,
  onSelectChat,
  query,
  setQuery,
  filter,
  setFilter,
}: {
  chats: readonly PrototypeChat[];
  selectedChatId: string;
  onSelectChat: (chatId: string) => void;
  query: string;
  setQuery: (query: string) => void;
  filter: PrototypeLens;
  setFilter: (filter: PrototypeLens) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const attentionChats = chats.filter((chat) => chat.attention !== "clear");
  const visibleChats = useMemo(
    () => chats.filter((chat) => matchesFilter(chat, filter, query)),
    [chats, filter, query],
  );

  return (
    <View style={[styles.inbox, { backgroundColor: theme.background }]}>
      <View style={styles.inboxHeader}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Compose a new message" style={styles.headerAction}>
            <Ionicons name="create-outline" size={25} color={theme.accent} />
          </Pressable>
        </View>
        <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={17} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filterRail}>
        <ScrollView
          horizontal
          style={styles.filterStrip}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          {FILTERS.map((item) => {
            const active = item.id === filter;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(item.id)}
                style={[
                  styles.filter,
                  {
                    backgroundColor: active ? theme.text : theme.background,
                    borderColor: active ? theme.text : theme.divider,
                  },
                ]}
              >
                <Ionicons name={item.icon} size={13} color={active ? theme.background : theme.textSecondary} />
                <Text style={[styles.filterLabel, { color: active ? theme.background : theme.textSecondary }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {filter === "all" && query.trim().length === 0 ? (
        <View style={[styles.shelfSection, { borderBottomColor: theme.divider }]}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Needs You</Text>
            <Text style={[styles.sectionCount, { color: theme.textSecondary }]}>{attentionChats.length}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfScroll}>
            {attentionChats.map((chat) => (
              <ShelfItem key={chat.id} chat={chat} selected={chat.id === selectedChatId} onPress={() => onSelectChat(chat.id)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.listHeading}>
        <Text style={[styles.listTitle, { color: theme.text }]}>{filter === "all" ? "Recent" : FILTERS.find((item) => item.id === filter)?.label}</Text>
        <Text style={[styles.listCount, { color: theme.textSecondary }]}>{visibleChats.length}</Text>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {visibleChats.length > 0 ? (
          visibleChats.map((chat) => (
            <ConversationRow key={chat.id} chat={chat} selected={chat.id === selectedChatId} onPress={() => onSelectChat(chat.id)} />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={25} color={theme.textSecondary} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No conversations</Text>
            <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>Try another search or filter.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export function PriorityShelf({ chats, messages, selectedChatId, onSelectChat }: PrototypeDesignProps): React.JSX.Element {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_BREAKPOINT;
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PrototypeLens>("all");
  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null;

  useEffect(() => {
    if (desktop) setMobileThreadOpen(false);
  }, [desktop]);

  const selectChat = (chatId: string): void => {
    onSelectChat(chatId);
    if (!desktop) setMobileThreadOpen(true);
  };

  if (!desktop && mobileThreadOpen && selectedChat) {
    return <Thread chat={selectedChat} messages={messages} onBack={() => setMobileThreadOpen(false)} />;
  }

  if (!desktop) {
    return (
      <Inbox
        chats={chats}
        selectedChatId={selectedChatId}
        onSelectChat={selectChat}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
      />
    );
  }

  return (
    <View style={[styles.desktopShell, { backgroundColor: theme.background }]}>
      <View style={[styles.desktopInbox, { borderRightColor: theme.divider }]}>
        <Inbox
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={selectChat}
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
        />
      </View>
      <View style={styles.desktopThread}>
        {selectedChat ? (
          <Thread chat={selectedChat} messages={messages} />
        ) : (
          <View style={[styles.emptyThread, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="chatbubble-outline" size={34} color={theme.textSecondary} />
            <Text style={[styles.emptyThreadText, { color: theme.textSecondary }]}>Select a conversation</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopShell: { flex: 1, flexDirection: "row" },
  desktopInbox: { width: 390, maxWidth: "43%", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "#8E8E93" },
  desktopThread: { flex: 1, minWidth: 0 },
  inbox: { flex: 1 },
  inboxHeader: { paddingHorizontal: 18, paddingTop: Platform.select({ ios: 14, default: 18 }), paddingBottom: 10 },
  titleLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 13 },
  title: { fontSize: 34, letterSpacing: -0.8, fontWeight: "700" },
  headerAction: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  searchField: { minHeight: 36, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 7, minWidth: 0 },
  filterRail: { height: 44, overflow: "hidden" },
  filterStrip: { flexGrow: 0, height: 44 },
  filterContent: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 18, gap: 7 },
  filter: { height: 32, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 11 },
  filterLabel: { fontSize: 13, lineHeight: 16, fontWeight: "600" },
  shelfSection: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 16 },
  sectionHeading: { flexDirection: "row", alignItems: "baseline", gap: 7, paddingHorizontal: 18, marginBottom: 10 },
  sectionTitle: { fontSize: 19, fontWeight: "700", letterSpacing: -0.2 },
  sectionCount: { fontSize: 14, fontWeight: "500" },
  shelfScroll: { paddingHorizontal: 18, gap: 16 },
  shelfItem: { width: 66, alignItems: "center" },
  shelfAvatarWrap: { position: "relative", marginBottom: 6 },
  shelfStatus: { position: "absolute", right: -2, bottom: -2, width: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  shelfName: { fontSize: 12, lineHeight: 15, fontWeight: "600", textAlign: "center", width: 76 },
  shelfMeta: { fontSize: 11, lineHeight: 14, textAlign: "center", width: 76 },
  listHeading: { flexDirection: "row", alignItems: "baseline", gap: 7, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 5 },
  listTitle: { fontSize: 19, fontWeight: "700", letterSpacing: -0.2 },
  listCount: { fontSize: 14, fontWeight: "500" },
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
  conversationRow: { minHeight: 75, flexDirection: "row", alignItems: "center", paddingRight: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  unreadColumn: { width: 17, alignItems: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  avatar: { alignItems: "center", justifyContent: "center" },
  groupAvatar: { position: "relative" },
  groupAvatarCircle: { position: "absolute", alignItems: "center", justifyContent: "center" },
  avatarInitials: { color: "#FFFFFF", fontWeight: "700" },
  rowCopy: { flex: 1, minWidth: 0, marginLeft: 11, paddingVertical: 10 },
  rowHeadline: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowName: { flex: 1, minWidth: 0, fontSize: 17, letterSpacing: -0.2 },
  rowTime: { fontSize: 13, flexShrink: 0 },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  rowPreview: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18 },
  unreadBadge: { minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  unreadBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingTop: 58, gap: 7 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyCopy: { fontSize: 14 },
  thread: { flex: 1 },
  threadHeader: { minHeight: 58, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { flexDirection: "row", alignItems: "center", width: 105, marginLeft: -8 },
  backLabel: { fontSize: 16, marginLeft: -4 },
  desktopHeaderSpacer: { width: 105 },
  threadContact: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0, justifyContent: "center" },
  threadContactCopy: { minWidth: 0, flexShrink: 1 },
  threadName: { textAlign: "center", fontSize: 15, fontWeight: "700" },
  threadStatus: { textAlign: "center", fontSize: 11, marginTop: 1 },
  infoButton: { width: 31, alignItems: "flex-end" },
  messageScroll: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 14, paddingTop: 24, paddingBottom: 16 },
  dayLabel: { alignSelf: "center", fontSize: 12, marginBottom: 18 },
  messageRow: { maxWidth: "80%", marginBottom: 12 },
  messageRowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageRowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  senderName: { fontSize: 12, marginLeft: 12, marginBottom: 3 },
  bubble: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleText: { fontSize: 16, lineHeight: 20 },
  messageMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, paddingHorizontal: 5 },
  messageTime: { fontSize: 11 },
  reaction: { fontSize: 13 },
  composer: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  composeAction: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 1 },
  composeInput: { flex: 1, minHeight: 36, maxHeight: 92, borderRadius: 18, paddingHorizontal: 13, paddingTop: 8, paddingBottom: 8, fontSize: 16 },
  sendButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", marginBottom: 1 },
  emptyThread: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#F7F7F7" },
  emptyThreadText: { color: "#8E8E93", fontSize: 16, fontWeight: "500" },
});
