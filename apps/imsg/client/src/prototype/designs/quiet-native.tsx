import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import type { PrototypeChat, PrototypeDesignProps, PrototypeLens, PrototypeMessage } from "../types";

const DESKTOP_BREAKPOINT = 768;

const FILTERS: readonly { label: string; value: PrototypeLens }[] = [
  { label: "All", value: "all" },
  { label: "Needs reply", value: "reply" },
  { label: "Unread", value: "unread" },
  { label: "Waiting", value: "waiting" },
  { label: "Groups", value: "groups" },
];

function chatMatchesLens(chat: PrototypeChat, lens: PrototypeLens): boolean {
  switch (lens) {
    case "reply":
      return chat.attention === "reply";
    case "unread":
      return chat.unreadCount > 0;
    case "waiting":
      return chat.attention === "waiting";
    case "groups":
      return chat.isGroup;
    case "all":
      return true;
  }
}

function ChatAvatar({ chat, size }: { chat: PrototypeChat; size: number }): React.JSX.Element {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: chat.avatarColor,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.max(12, size * 0.34) }]}>{chat.initials}</Text>
    </View>
  );
}

function ChatRow({
  chat,
  selected,
  onPress,
}: {
  chat: PrototypeChat;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const prefix = chat.lastFromMe && !chat.preview.startsWith("You:") ? "You: " : "";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chatRow,
        { backgroundColor: selected || pressed ? theme.backgroundSelected : theme.background },
      ]}
    >
      <ChatAvatar chat={chat} size={48} />
      <View style={styles.chatCopy}>
        <View style={styles.chatTopline}>
          <Text
            numberOfLines={1}
            style={[styles.chatName, { color: theme.text, fontWeight: chat.unreadCount > 0 ? "700" : "600" }]}
          >
            {chat.name}
          </Text>
          <Text style={[styles.chatTime, { color: chat.unreadCount > 0 ? theme.accent : theme.textSecondary }]}>
            {chat.time}
          </Text>
        </View>
        <View style={styles.previewLine}>
          <Text
            numberOfLines={1}
            style={[styles.chatPreview, { color: theme.textSecondary, fontWeight: chat.unreadCount > 0 ? "500" : "400" }]}
          >
            {prefix}
            {chat.preview}
          </Text>
          {chat.unreadCount > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
              <Text style={styles.unreadCount}>{chat.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function ListHeader({
  query,
  onChangeQuery,
  lens,
  onChangeLens,
  filterOpen,
  onToggleFilter,
}: {
  query: string;
  onChangeQuery: (value: string) => void;
  lens: PrototypeLens;
  onChangeLens: (value: PrototypeLens) => void;
  filterOpen: boolean;
  onToggleFilter: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const activeFilter = FILTERS.find((filter) => filter.value === lens)?.label ?? "All";

  return (
    <View style={[styles.listHeader, { backgroundColor: theme.background, borderBottomColor: theme.divider }]}>
      <View style={styles.titleLine}>
        <Text style={[styles.inboxTitle, { color: theme.text }]}>Messages</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New message"
          hitSlop={8}
          style={styles.iconButton}
        >
          <Ionicons name="create-outline" size={23} color={theme.accent} />
        </Pressable>
      </View>
      <View style={styles.searchLine}>
        <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            accessibilityLabel="Search messages"
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Search"
            placeholderTextColor={theme.textSecondary}
            selectionColor={theme.accent}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query.length > 0 && (
            <Pressable accessibilityLabel="Clear search" onPress={() => onChangeQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter conversations"
          accessibilityState={{ expanded: filterOpen }}
          onPress={onToggleFilter}
          style={({ pressed }) => [
            styles.filterButton,
            { backgroundColor: filterOpen || lens !== "all" || pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}
        >
          <Ionicons name="options-outline" size={17} color={lens === "all" ? theme.textSecondary : theme.accent} />
          {lens !== "all" && <Text style={[styles.filterCount, { color: theme.accent }]}>{activeFilter === "Needs reply" ? "!" : "1"}</Text>}
        </Pressable>
      </View>
      {filterOpen && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterStrip}>
          {FILTERS.map((filter) => {
            const active = filter.value === lens;
            return (
              <Pressable
                key={filter.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChangeLens(filter.value);
                  onToggleFilter();
                }}
                style={[styles.filterPill, { backgroundColor: active ? theme.accent : theme.backgroundElement }]}
              >
                <Text style={[styles.filterLabel, { color: active ? "#FFFFFF" : theme.text }]}>{filter.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function ConversationList({
  chats,
  selectedChatId,
  onSelectChat,
  query,
  lens,
}: {
  chats: readonly PrototypeChat[];
  selectedChatId: string;
  onSelectChat: (chatId: string) => void;
  query: string;
  lens: PrototypeLens;
}): React.JSX.Element {
  const theme = useTheme();
  const filteredChats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return chats.filter(
      (chat) =>
        chatMatchesLens(chat, lens) &&
        (normalizedQuery.length === 0 ||
          chat.name.toLocaleLowerCase().includes(normalizedQuery) ||
          chat.preview.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [chats, lens, query]);
  const replyChats = filteredChats.filter((chat) => chat.attention === "reply");
  const remainingChats = filteredChats.filter((chat) => chat.attention !== "reply");

  return (
    <ScrollView style={[styles.list, { backgroundColor: theme.background }]} contentContainerStyle={styles.listContent}>
      {replyChats.length > 0 && (
        <View style={[styles.replySection, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.sectionLabelLine}>
            <Ionicons name="arrow-undo-outline" size={15} color={theme.accent} />
            <Text style={[styles.sectionLabel, { color: theme.text }]}>Needs Reply</Text>
            <Text style={[styles.sectionCount, { color: theme.textSecondary }]}>{replyChats.length}</Text>
          </View>
          <View style={[styles.replyRows, { backgroundColor: theme.background }]}>
            {replyChats.map((chat) => (
              <ChatRow key={chat.id} chat={chat} selected={chat.id === selectedChatId} onPress={() => onSelectChat(chat.id)} />
            ))}
          </View>
        </View>
      )}
      {remainingChats.length > 0 && (
        <View style={styles.remainder}>
          {replyChats.length > 0 && <Text style={[styles.remainderLabel, { color: theme.textSecondary }]}>RECENT</Text>}
          {remainingChats.map((chat) => (
            <ChatRow key={chat.id} chat={chat} selected={chat.id === selectedChatId} onPress={() => onSelectChat(chat.id)} />
          ))}
        </View>
      )}
      {filteredChats.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={24} color={theme.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No conversations found</Text>
          <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>Try another search or filter.</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Composer(): React.JSX.Element {
  const theme = useTheme();
  const [draft, setDraft] = useState("");

  return (
    <View style={[styles.composer, { backgroundColor: theme.background, borderTopColor: theme.divider }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" hitSlop={8}>
        <Ionicons name="add-circle" size={28} color={theme.accent} />
      </Pressable>
      <View style={[styles.messageInputWrap, { backgroundColor: theme.backgroundElement }]}>
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder="iMessage"
          placeholderTextColor={theme.textSecondary}
          selectionColor={theme.accent}
          style={[styles.messageInput, { color: theme.text }]}
        />
        {draft.length === 0 && <Ionicons name="mic" size={18} color={theme.textSecondary} />}
      </View>
      {draft.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" hitSlop={8}>
          <Ionicons name="arrow-up-circle" size={30} color={theme.accent} />
        </Pressable>
      )}
    </View>
  );
}

function Thread({
  chat,
  messages,
  onBack,
  showBack,
}: {
  chat: PrototypeChat | undefined;
  messages: readonly PrototypeMessage[];
  onBack: () => void;
  showBack: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const threadMessages = useMemo(() => messages.filter((message) => message.chatId === chat?.id), [chat?.id, messages]);

  if (!chat) {
    return (
      <View style={[styles.threadEmpty, { backgroundColor: theme.background }]}>
        <Ionicons name="chatbubble-outline" size={36} color={theme.textSecondary} />
        <Text style={[styles.threadEmptyTitle, { color: theme.text }]}>Select a conversation</Text>
        <Text style={[styles.threadEmptyCopy, { color: theme.textSecondary }]}>Choose a message to read and reply.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.thread, { backgroundColor: theme.background }]}
    >
      <View style={[styles.threadHeader, { borderBottomColor: theme.divider }]}>
        <View style={styles.threadHeaderSide}>
          {showBack && (
            <Pressable accessibilityRole="button" accessibilityLabel="Back to messages" onPress={onBack} hitSlop={8}>
              <Ionicons name="chevron-back" size={29} color={theme.accent} />
            </Pressable>
          )}
        </View>
        <View style={styles.threadIdentity}>
          <ChatAvatar chat={chat} size={30} />
          <View style={styles.threadTitleCopy}>
            <Text numberOfLines={1} style={[styles.threadName, { color: theme.text }]}>{chat.name}</Text>
            {chat.isGroup && <Text style={[styles.threadMeta, { color: theme.textSecondary }]}>{chat.participants} people</Text>}
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Conversation details" hitSlop={8} style={styles.threadHeaderSide}>
          <Ionicons name="information-circle-outline" size={23} color={theme.accent} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.messageList}>
        <Text style={[styles.messageDate, { color: theme.textSecondary }]}>Today</Text>
        {threadMessages.map((message) => (
          <View key={message.id} style={[styles.messageGroup, message.fromMe ? styles.messageFromMe : styles.messageFromThem]}>
            {!message.fromMe && message.sender && <Text style={[styles.senderName, { color: theme.textSecondary }]}>{message.sender}</Text>}
            <View style={[styles.bubble, { backgroundColor: message.fromMe ? theme.bubbleMine : theme.bubbleTheirs }]}>
              <Text style={[styles.bubbleText, { color: message.fromMe ? "#FFFFFF" : theme.bubbleTheirsText }]}>{message.text}</Text>
            </View>
            {message.reaction && (
              <View style={[styles.reaction, { backgroundColor: theme.backgroundElement, borderColor: theme.background }]}>
                <Text style={styles.reactionText}>{message.reaction}</Text>
              </View>
            )}
            <Text style={[styles.messageTime, { color: theme.textSecondary }]}>{message.time}</Text>
          </View>
        ))}
      </ScrollView>
      <Composer />
    </KeyboardAvoidingView>
  );
}

export function QuietNative({ chats, messages, selectedChatId, onSelectChat }: PrototypeDesignProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<PrototypeLens>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileThreadVisible, setMobileThreadVisible] = useState(false);
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);
  const showThread = isDesktop || (mobileThreadVisible && selectedChat !== undefined);
  const listSelectedChatId = isDesktop || mobileThreadVisible ? selectedChatId : "";

  const selectChat = (chatId: string): void => {
    setMobileThreadVisible(true);
    onSelectChat(chatId);
  };
  const clearSelection = (): void => setMobileThreadVisible(false);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.shell, { backgroundColor: theme.background }]}>
        <View style={[styles.sidebar, isDesktop && styles.sidebarDesktop, { borderRightColor: theme.divider }]}>
          <ListHeader
            query={query}
            onChangeQuery={setQuery}
            lens={lens}
            onChangeLens={setLens}
            filterOpen={filterOpen}
            onToggleFilter={() => setFilterOpen((open) => !open)}
          />
          <ConversationList chats={chats} selectedChatId={listSelectedChatId} onSelectChat={selectChat} query={query} lens={lens} />
        </View>
        {showThread && (
          <View style={[styles.threadPane, !isDesktop && styles.threadPaneMobile]}>
            <Thread chat={selectedChat} messages={messages} onBack={clearSelection} showBack={!isDesktop} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  shell: { flex: 1, flexDirection: "row", minHeight: 0 },
  sidebar: { flex: 1, minWidth: 0 },
  sidebarDesktop: { width: 354, flexBasis: 354, maxWidth: 400, flexGrow: 0, borderRightWidth: StyleSheet.hairlineWidth },
  threadPane: { flex: 1, minWidth: 0 },
  threadPaneMobile: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  listHeader: { paddingTop: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  titleLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
  inboxTitle: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.6 },
  iconButton: { width: 32, height: 32, alignItems: "flex-end", justifyContent: "center" },
  searchLine: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  searchField: { height: 34, borderRadius: 10, flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 9, gap: 6 },
  searchInput: { flex: 1, minWidth: 0, alignSelf: "stretch", paddingVertical: 0, fontSize: 16 },
  filterButton: { width: 36, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  filterCount: { position: "absolute", top: 2, right: 5, fontSize: 10, fontWeight: "700" },
  filterStrip: { gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  filterPill: { minHeight: 28, borderRadius: 14, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  filterLabel: { fontSize: 13, fontWeight: "600" },
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
  replySection: { paddingBottom: 10 },
  sectionLabelLine: { minHeight: 31, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  sectionLabel: { fontSize: 14, fontWeight: "700" },
  sectionCount: { fontSize: 13, fontWeight: "600" },
  replyRows: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "transparent" },
  remainder: { paddingTop: 4 },
  remainderLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.7, paddingHorizontal: 16, paddingVertical: 8 },
  chatRow: { minHeight: 67, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { color: "#FFFFFF", fontWeight: "700", letterSpacing: -0.3 },
  chatCopy: { flex: 1, minWidth: 0, gap: 2 },
  chatTopline: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  chatName: { flex: 1, minWidth: 0, fontSize: 16, letterSpacing: -0.15 },
  chatTime: { fontSize: 13, flexShrink: 0 },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  chatPreview: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18 },
  unreadBadge: { minWidth: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadCount: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingTop: 70, paddingHorizontal: 24 },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: "600" },
  emptyCopy: { marginTop: 3, fontSize: 14 },
  thread: { flex: 1, minHeight: 0 },
  threadEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  threadEmptyTitle: { marginTop: 12, fontSize: 17, fontWeight: "600" },
  threadEmptyCopy: { marginTop: 4, fontSize: 14 },
  threadHeader: { height: 59, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  threadHeaderSide: { width: 30, alignItems: "center" },
  threadIdentity: { maxWidth: "68%", flexDirection: "row", alignItems: "center", gap: 8 },
  threadTitleCopy: { minWidth: 0, alignItems: "center" },
  threadName: { fontSize: 15, fontWeight: "700" },
  threadMeta: { fontSize: 11, marginTop: 1 },
  messageList: { flexGrow: 1, paddingHorizontal: 12, paddingTop: 17, paddingBottom: 18, justifyContent: "flex-end", gap: 8 },
  messageDate: { alignSelf: "center", fontSize: 12, marginBottom: 5 },
  messageGroup: { maxWidth: "78%" },
  messageFromMe: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageFromThem: { alignSelf: "flex-start", alignItems: "flex-start" },
  senderName: { fontSize: 12, marginBottom: 3, marginLeft: 4 },
  bubble: { borderRadius: 19, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleText: { fontSize: 16, lineHeight: 21 },
  messageTime: { fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  reaction: { position: "absolute", right: -6, bottom: 14, minWidth: 25, height: 19, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  reactionText: { fontSize: 11 },
  composer: { minHeight: 55, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  messageInputWrap: { minHeight: 34, borderRadius: 17, flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 10, gap: 6 },
  messageInput: { flex: 1, minWidth: 0, minHeight: 34, paddingVertical: 0, fontSize: 16 },
});
