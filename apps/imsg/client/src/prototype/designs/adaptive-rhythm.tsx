import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import type React from "react";
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

const FILTERS: readonly { label: string; value: PrototypeLens }[] = [
  { label: "All", value: "all" },
  { label: "Reply", value: "reply" },
  { label: "Unread", value: "unread" },
  { label: "Waiting", value: "waiting" },
  { label: "Groups", value: "groups" },
];

export function AdaptiveRhythm({
  chats,
  messages,
  selectedChatId,
  onSelectChat,
}: PrototypeDesignProps): React.JSX.Element {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const [lens, setLens] = useState<PrototypeLens>("all");
  const [query, setQuery] = useState("");
  const [showThread, setShowThread] = useState(false);
  const [newMessage, setNewMessage] = useState(false);

  const filteredChats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return chats.filter((chat) => {
      const matchesLens =
        lens === "all" ||
        (lens === "reply" && chat.attention === "reply") ||
        (lens === "unread" && chat.unreadCount > 0) ||
        (lens === "waiting" && chat.attention === "waiting") ||
        (lens === "groups" && chat.isGroup);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        chat.name.toLocaleLowerCase().includes(normalizedQuery) ||
        chat.preview.toLocaleLowerCase().includes(normalizedQuery);
      return matchesLens && matchesQuery;
    });
  }, [chats, lens, query]);

  const priorityChats = filteredChats.filter((chat) => chat.attention === "reply");
  const remainderChats = filteredChats.filter((chat) => chat.attention !== "reply");
  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null;

  const selectChat = (chatId: string): void => {
    onSelectChat(chatId);
    setShowThread(true);
    setNewMessage(false);
  };

  const inbox = (
    <Inbox
      theme={theme}
      lens={lens}
      query={query}
      newMessage={newMessage}
      priorityChats={priorityChats}
      remainderChats={remainderChats}
      selectedChatId={selectedChatId}
      onLensChange={setLens}
      onQueryChange={setQuery}
      onNewMessage={() => setNewMessage((current) => !current)}
      onSelectChat={selectChat}
    />
  );

  if (!isDesktop && showThread && selectedChat) {
    return (
      <Thread
        key={selectedChat.id}
        theme={theme}
        chat={selectedChat}
        messages={messages.filter((message) => message.chatId === selectedChat.id)}
        onBack={() => setShowThread(false)}
      />
    );
  }

  if (!isDesktop) return inbox;

  return (
    <View style={[styles.desktopShell, { backgroundColor: theme.background }]}>
      <View style={[styles.inboxPane, { borderRightColor: theme.divider }]}>{inbox}</View>
      <View style={styles.threadPane}>
        {selectedChat ? (
          <Thread
            key={selectedChat.id}
            theme={theme}
            chat={selectedChat}
            messages={messages.filter((message) => message.chatId === selectedChat.id)}
          />
        ) : (
          <EmptyThread theme={theme} />
        )}
      </View>
    </View>
  );
}

interface Theme {
  readonly text: string;
  readonly background: string;
  readonly backgroundElement: string;
  readonly backgroundSelected: string;
  readonly textSecondary: string;
  readonly accent: string;
  readonly bubbleMine: string;
  readonly bubbleTheirs: string;
  readonly bubbleTheirsText: string;
  readonly divider: string;
}

interface InboxProps {
  readonly theme: Theme;
  readonly lens: PrototypeLens;
  readonly query: string;
  readonly newMessage: boolean;
  readonly priorityChats: readonly PrototypeChat[];
  readonly remainderChats: readonly PrototypeChat[];
  readonly selectedChatId: string;
  readonly onLensChange: (lens: PrototypeLens) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onNewMessage: () => void;
  readonly onSelectChat: (chatId: string) => void;
}

function Inbox({
  theme,
  lens,
  query,
  newMessage,
  priorityChats,
  remainderChats,
  selectedChatId,
  onLensChange,
  onQueryChange,
  onNewMessage,
  onSelectChat,
}: InboxProps): React.JSX.Element {
  return (
    <View style={[styles.inbox, { backgroundColor: theme.background }]}>
      <View style={styles.inboxHeader}>
        <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
        <Pressable
          accessibilityLabel="New message"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onNewMessage}
          style={({ pressed }) => [styles.composeButton, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Ionicons color={theme.accent} name="pencil" size={23} />
        </Pressable>
      </View>

      {newMessage && (
        <View style={[styles.newMessage, { borderBottomColor: theme.divider }]}>
          <Ionicons color={theme.textSecondary} name="person-add-outline" size={17} />
          <TextInput
            autoFocus
            placeholder="To:"
            placeholderTextColor={theme.textSecondary}
            selectionColor={theme.accent}
            style={[styles.newMessageInput, { color: theme.text }]}
          />
        </View>
      )}

      <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons color={theme.textSecondary} name="search" size={16} />
        <TextInput
          accessibilityLabel="Search messages"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onQueryChange}
          placeholder="Search"
          placeholderTextColor={theme.textSecondary}
          selectionColor={theme.accent}
          style={[styles.searchInput, { color: theme.text }]}
          value={query}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
        style={styles.filterBar}
      >
        {FILTERS.map((filter) => {
          const active = filter.value === lens;
          return (
            <Pressable
              key={filter.value}
              accessibilityRole="button"
              onPress={() => onLensChange(filter.value)}
              style={({ pressed }) => [
                styles.filter,
                {
                  backgroundColor: active ? theme.text : theme.backgroundElement,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <Text style={[styles.filterLabel, { color: active ? theme.background : theme.textSecondary }]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {priorityChats.length > 0 && (
          <>
            <SectionLabel label="Needs your attention" theme={theme} />
            {priorityChats.map((chat) => (
              <RhythmRow
                key={chat.id}
                chat={chat}
                selected={chat.id === selectedChatId}
                theme={theme}
                onPress={() => onSelectChat(chat.id)}
              />
            ))}
          </>
        )}

        {remainderChats.length > 0 && (
          <>
            <SectionLabel label={priorityChats.length > 0 ? "Recent" : "Messages"} theme={theme} />
            {remainderChats.map((chat) => (
              <RhythmRow
                key={chat.id}
                chat={chat}
                selected={chat.id === selectedChatId}
                theme={theme}
                onPress={() => onSelectChat(chat.id)}
              />
            ))}
          </>
        )}

        {priorityChats.length === 0 && remainderChats.length === 0 && (
          <View style={styles.emptyList}>
            <Text style={[styles.emptyListText, { color: theme.textSecondary }]}>No conversations found</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SectionLabel({ label, theme }: { readonly label: string; readonly theme: Theme }): React.JSX.Element {
  return <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{label}</Text>;
}

function RhythmRow({
  chat,
  selected,
  theme,
  onPress,
}: {
  readonly chat: PrototypeChat;
  readonly selected: boolean;
  readonly theme: Theme;
  readonly onPress: () => void;
}): React.JSX.Element {
  const isReply = chat.attention === "reply";
  const isWaiting = chat.attention === "waiting";
  const rowStyle = isReply ? styles.replyRow : isWaiting ? styles.waitingRow : styles.clearRow;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        rowStyle,
        {
          backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : theme.background,
          borderBottomColor: theme.divider,
        },
      ]}
    >
      <Avatar chat={chat} size={isReply ? 46 : isWaiting ? 40 : 34} />
      <View style={styles.rowContent}>
        <View style={styles.rowTopLine}>
          <Text numberOfLines={1} style={[styles.rowName, { color: theme.text, fontWeight: chat.unreadCount > 0 ? "700" : "600" }]}>
            {chat.name}
          </Text>
          <Text style={[styles.rowTime, { color: chat.unreadCount > 0 ? theme.accent : theme.textSecondary }]}>{chat.time}</Text>
        </View>
        {isReply ? (
          <Text numberOfLines={2} style={[styles.replyPreview, { color: theme.textSecondary }]}>
            {chat.preview}
          </Text>
        ) : (
          <Text numberOfLines={1} style={[styles.preview, { color: theme.textSecondary }]}>
            {chat.preview}
          </Text>
        )}
        {isReply && (
          <View style={styles.replyMeta}>
            <Ionicons color={theme.accent} name="return-up-back" size={12} />
            <Text style={[styles.replyAction, { color: theme.accent }]}>Reply</Text>
          </View>
        )}
        {isWaiting && (
          <View style={styles.waitingMeta}>
            <Ionicons color={theme.textSecondary} name="time-outline" size={13} />
            <Text style={[styles.waitingLabel, { color: theme.textSecondary }]}>Waiting on them</Text>
          </View>
        )}
      </View>
      {chat.unreadCount > 0 && (
        <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
          <Text style={styles.unreadCount}>{chat.unreadCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Avatar({ chat, size }: { readonly chat: PrototypeChat; readonly size: number }): React.JSX.Element {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: chat.avatarColor }]}>
      <Text style={[styles.avatarText, { fontSize: size > 36 ? 14 : 11 }]}>{chat.initials}</Text>
    </View>
  );
}

function Thread({
  theme,
  chat,
  messages,
  onBack,
}: {
  readonly theme: Theme;
  readonly chat: PrototypeChat;
  readonly messages: readonly PrototypeMessage[];
  readonly onBack?: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [sentMessages, setSentMessages] = useState<readonly PrototypeMessage[]>([]);
  const allMessages = [...messages, ...sentMessages];
  const firstMessageTime = messages[0]?.time ?? "Today";
  const dayLabel = /^\d/.test(firstMessageTime) ? "Today" : firstMessageTime;

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    setSentMessages((current) => [
      ...current,
      { id: `draft-${current.length}`, chatId: chat.id, text, time: "Now", fromMe: true },
    ]);
    setDraft("");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.thread, { backgroundColor: theme.background }]}
    >
      <View style={[styles.threadHeader, { borderBottomColor: theme.divider }]}>
        {onBack && (
          <Pressable accessibilityLabel="Back to messages" hitSlop={8} onPress={onBack} style={styles.backButton}>
            <Ionicons color={theme.accent} name="chevron-back" size={28} />
            <Text style={[styles.backLabel, { color: theme.accent }]}>Messages</Text>
          </Pressable>
        )}
        <View style={[styles.threadIdentity, !onBack && styles.threadIdentityDesktop]}>
          <Avatar chat={chat} size={32} />
          <View style={styles.threadTitleWrap}>
            <Text numberOfLines={1} style={[styles.threadTitle, { color: theme.text }]}>{chat.name}</Text>
            <Text style={[styles.threadSubtitle, { color: theme.textSecondary }]}>
              {chat.isGroup ? `${chat.participants} people` : "iMessage"}
            </Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Conversation details" hitSlop={8} style={styles.infoButton}>
          <Ionicons color={theme.accent} name="information-circle-outline" size={25} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.messageList} showsVerticalScrollIndicator={false}>
        <Text style={[styles.dayStamp, { color: theme.textSecondary }]}>{dayLabel}</Text>
        {allMessages.map((message) => (
          <View key={message.id} style={[styles.messageWrap, message.fromMe ? styles.messageFromMe : styles.messageFromThem]}>
            {!message.fromMe && chat.isGroup && message.sender && (
              <Text style={[styles.sender, { color: theme.textSecondary }]}>{message.sender}</Text>
            )}
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor: message.fromMe ? theme.bubbleMine : theme.bubbleTheirs,
                  borderBottomRightRadius: message.fromMe ? 4 : 20,
                  borderBottomLeftRadius: message.fromMe ? 20 : 4,
                },
              ]}
            >
              <Text style={[styles.messageText, { color: message.fromMe ? "#FFFFFF" : theme.bubbleTheirsText }]}>
                {message.text}
              </Text>
            </View>
            {message.reaction && (
              <View style={[styles.reaction, { backgroundColor: theme.backgroundElement, borderColor: theme.background }]}>
                <Text style={styles.reactionText}>{message.reaction}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: theme.divider }]}>
        <Pressable accessibilityLabel="Add attachment" hitSlop={7}>
          <Ionicons color={theme.accent} name="add-circle" size={27} />
        </Pressable>
        <View style={[styles.draftField, { backgroundColor: theme.backgroundElement }]}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="iMessage"
            placeholderTextColor={theme.textSecondary}
            selectionColor={theme.accent}
            style={[styles.draftInput, { color: theme.text }]}
            value={draft}
          />
          {draft.trim().length > 0 ? (
            <Pressable accessibilityLabel="Send" hitSlop={6} onPress={send}>
              <Ionicons color={theme.accent} name="arrow-up-circle" size={27} />
            </Pressable>
          ) : (
            <Ionicons color={theme.textSecondary} name="mic-outline" size={21} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function EmptyThread({ theme }: { readonly theme: Theme }): React.JSX.Element {
  return (
    <View style={styles.emptyThread}>
      <Ionicons color={theme.textSecondary} name="chatbubble-outline" size={34} />
      <Text style={[styles.emptyThreadTitle, { color: theme.text }]}>Select a conversation</Text>
      <Text style={[styles.emptyThreadCopy, { color: theme.textSecondary }]}>Your messages stay in one quiet place.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopShell: { flex: 1, flexDirection: "row" },
  inboxPane: { width: 360, maxWidth: "42%", borderRightWidth: StyleSheet.hairlineWidth },
  threadPane: { flex: 1, minWidth: 0 },
  inbox: { flex: 1 },
  inboxHeader: { height: 62, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.6 },
  composeButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  newMessage: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 18, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  newMessageInput: { flex: 1, height: 32, fontSize: 16 },
  searchField: { height: 34, borderRadius: 10, marginHorizontal: 14, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  searchInput: { flex: 1, height: "100%", fontSize: 15, paddingVertical: Platform.select({ android: 0, default: 5 }) },
  filterBar: { flexGrow: 0, marginTop: 12 },
  filterScroll: { paddingHorizontal: 14, gap: 6, paddingBottom: 11 },
  filter: { minHeight: 28, borderRadius: 14, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  filterLabel: { fontSize: 12, fontWeight: "600" },
  listContent: { paddingBottom: 28 },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.55, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  replyRow: { minHeight: 82, paddingVertical: 10 },
  waitingRow: { minHeight: 62, paddingVertical: 8 },
  clearRow: { minHeight: 50, paddingVertical: 7 },
  rowContent: { flex: 1, minWidth: 0 },
  rowTopLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowName: { flex: 1, minWidth: 0, fontSize: 16, letterSpacing: -0.15 },
  rowTime: { fontSize: 12, fontWeight: "500" },
  preview: { fontSize: 13, lineHeight: 17, marginTop: 1 },
  replyPreview: { fontSize: 13, lineHeight: 17, marginTop: 2 },
  replyMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  replyAction: { fontSize: 12, fontWeight: "700" },
  waitingMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  waitingLabel: { fontSize: 11.5, fontWeight: "500" },
  avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { color: "#FFFFFF", fontWeight: "700", letterSpacing: -0.2 },
  unreadBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  unreadCount: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  emptyList: { alignItems: "center", paddingTop: 50 },
  emptyListText: { fontSize: 14 },
  thread: { flex: 1 },
  threadHeader: { minHeight: 58, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { flexDirection: "row", alignItems: "center", marginRight: 3, marginLeft: -7 },
  backLabel: { fontSize: 15, marginLeft: -5 },
  threadIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9, justifyContent: "center" },
  threadIdentityDesktop: { justifyContent: "flex-start" },
  threadTitleWrap: { minWidth: 0 },
  threadTitle: { fontSize: 15, lineHeight: 18, fontWeight: "700", textAlign: "center" },
  threadSubtitle: { fontSize: 11, lineHeight: 14, textAlign: "center" },
  infoButton: { width: 29, alignItems: "flex-end" },
  messageList: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 14, paddingTop: 16, paddingBottom: 18 },
  dayStamp: { textAlign: "center", fontSize: 11, marginBottom: 16 },
  messageWrap: { maxWidth: "78%", marginBottom: 5 },
  messageFromMe: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageFromThem: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { fontSize: 11, marginLeft: 5, marginBottom: 2 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  messageText: { fontSize: 16, lineHeight: 20 },
  reaction: { position: "absolute", bottom: -8, right: -7, borderWidth: 2, borderRadius: 11, paddingHorizontal: 5, paddingVertical: 1 },
  reactionText: { fontSize: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.select({ ios: 12, default: 9 }), borderTopWidth: StyleSheet.hairlineWidth },
  draftField: { flex: 1, minHeight: 36, maxHeight: 98, borderRadius: 18, paddingLeft: 12, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  draftInput: { flex: 1, fontSize: 16, lineHeight: 20, maxHeight: 80, paddingVertical: 8 },
  emptyThread: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  emptyThreadTitle: { marginTop: 12, fontSize: 17, fontWeight: "700" },
  emptyThreadCopy: { marginTop: 4, fontSize: 14, textAlign: "center" },
});
