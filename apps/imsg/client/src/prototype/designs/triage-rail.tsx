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

const RAIL_ITEMS: readonly { lens: PrototypeLens; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { lens: "all", icon: "chatbubble-ellipses-outline", label: "Inbox" },
  { lens: "reply", icon: "arrow-undo-outline", label: "Reply" },
  { lens: "unread", icon: "ellipse-outline", label: "Unread" },
  { lens: "waiting", icon: "time-outline", label: "Waiting" },
  { lens: "groups", icon: "people-outline", label: "Groups" },
];

function matchesLens(chat: PrototypeChat, lens: PrototypeLens): boolean {
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

function Avatar({ chat, size = 38 }: { chat: PrototypeChat; size?: number }): React.JSX.Element {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: chat.avatarColor }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.34 }]}>{chat.initials}</Text>
    </View>
  );
}

function RailButton({
  item,
  active,
  count,
  onPress,
  compact = false,
}: {
  item: (typeof RAIL_ITEMS)[number];
  active: boolean;
  count: number;
  onPress: () => void;
  compact?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.bottomRailItem : styles.railItem,
        { backgroundColor: active ? theme.backgroundSelected : pressed ? theme.backgroundElement : "transparent" },
      ]}
    >
      <View>
        <Ionicons name={item.icon} size={compact ? 21 : 20} color={active ? theme.accent : theme.textSecondary} />
        {count > 0 && <View style={[styles.railBadge, { backgroundColor: theme.accent }]} />}
      </View>
      {!compact && <Text style={[styles.railLabel, { color: active ? theme.text : theme.textSecondary }]}>{item.label}</Text>}
      {compact && <Text style={[styles.bottomRailLabel, { color: active ? theme.text : theme.textSecondary }]}>{item.label}</Text>}
    </Pressable>
  );
}

function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  mobile,
}: {
  chats: readonly PrototypeChat[];
  selectedChatId: string;
  onSelectChat: (chatId: string) => void;
  mobile: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const priority = chats.filter((chat) => chat.attention === "reply" || chat.unreadCount > 0);
  const rest = chats.filter((chat) => !priority.some((priorityChat) => priorityChat.id === chat.id));

  const renderRow = (chat: PrototypeChat): React.JSX.Element => {
    const selected = chat.id === selectedChatId;
    return (
      <Pressable
        key={chat.id}
        onPress={() => onSelectChat(chat.id)}
        style={({ pressed }) => [
          styles.chatRow,
          mobile && styles.chatRowMobile,
          { backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : "transparent" },
        ]}
      >
        <Avatar chat={chat} size={mobile ? 46 : 38} />
        <View style={styles.chatRowCopy}>
          <View style={styles.chatRowTop}>
            <Text numberOfLines={1} style={[styles.chatName, { color: theme.text, fontWeight: chat.unreadCount > 0 ? "700" : "600" }]}>
              {chat.name}
            </Text>
            <Text style={[styles.chatTime, { color: theme.textSecondary }]}>{chat.time}</Text>
          </View>
          <View style={styles.chatRowBottom}>
            <Text numberOfLines={1} style={[styles.chatPreview, { color: theme.textSecondary }]}>{chat.preview}</Text>
            {chat.unreadCount > 0 && (
              <View style={[styles.unreadCount, { backgroundColor: theme.accent }]}>
                <Text style={styles.unreadCountText}>{chat.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.chatScroll} keyboardShouldPersistTaps="handled">
      {priority.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>PRIORITY</Text>
          {priority.map(renderRow)}
        </View>
      )}
      {rest.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>RECENT</Text>
          {rest.map(renderRow)}
        </View>
      )}
    </ScrollView>
  );
}

function Thread({
  chat,
  messages,
  onBack,
  mobile,
}: {
  chat: PrototypeChat | undefined;
  messages: readonly PrototypeMessage[];
  onBack: () => void;
  mobile: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const [draft, setDraft] = useState("");
  const [sentMessages, setSentMessages] = useState<readonly PrototypeMessage[]>([]);
  const threadMessages = useMemo(
    () => [...messages.filter((message) => message.chatId === chat?.id), ...sentMessages],
    [chat?.id, messages, sentMessages],
  );

  useEffect(() => {
    setDraft("");
    setSentMessages([]);
  }, [chat?.id]);

  const send = (): void => {
    const text = draft.trim();
    if (!text || !chat) return;
    setSentMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, chatId: chat.id, text, time: "Now", fromMe: true },
    ]);
    setDraft("");
  };

  if (!chat) {
    return (
      <View style={[styles.emptyThread, { backgroundColor: theme.background }]}>
        <Ionicons name="chatbubble-outline" size={28} color={theme.textSecondary} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>Choose a conversation</Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>Your thread stays open beside the inbox.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.thread, { backgroundColor: theme.background }]}>
      <View style={[styles.threadHeader, { borderBottomColor: theme.divider }]}>
        {mobile && (
          <Pressable accessibilityLabel="Back to inbox" onPress={onBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color={theme.accent} />
            <Text style={[styles.backText, { color: theme.accent }]}>Inbox</Text>
          </Pressable>
        )}
        <View style={styles.threadIdentity}>
          <Avatar chat={chat} size={30} />
          <View>
            <Text style={[styles.threadName, { color: theme.text }]}>{chat.name}</Text>
            <Text style={[styles.threadMeta, { color: theme.textSecondary }]}>{chat.isGroup ? `${chat.participants} people` : "iMessage"}</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Conversation info" style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={22} color={theme.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.messageScroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>TODAY</Text>
        {threadMessages.map((message) => (
          <View key={message.id} style={[styles.messageGroup, message.fromMe ? styles.messageMine : styles.messageTheirs]}>
            {!message.fromMe && message.sender && <Text style={[styles.sender, { color: theme.textSecondary }]}>{message.sender}</Text>}
            <View style={[styles.bubble, { backgroundColor: message.fromMe ? theme.bubbleMine : theme.bubbleTheirs }]}>
              <Text style={[styles.messageText, { color: message.fromMe ? "#FFFFFF" : theme.bubbleTheirsText }]}>{message.text}</Text>
            </View>
            <Text style={[styles.messageTime, { color: theme.textSecondary }]}>{message.time}</Text>
            {message.reaction && <Text style={[styles.reaction, { backgroundColor: theme.backgroundElement }]}>{message.reaction}</Text>}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
        <Pressable accessibilityLabel="Add attachment" style={styles.composerPlus}>
          <Ionicons name="add-circle" size={27} color={theme.accent} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder="iMessage"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="send"
          style={[styles.composerInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Pressable accessibilityLabel="Send message" onPress={send} disabled={!draft.trim()} style={styles.sendButton}>
          <Ionicons name="arrow-up-circle" size={29} color={draft.trim() ? theme.accent : theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export function TriageRail({ chats, messages, selectedChatId, onSelectChat }: PrototypeDesignProps): React.JSX.Element {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= 768;
  const [lens, setLens] = useState<PrototypeLens>("all");
  const [query, setQuery] = useState("");
  const [mobileScreen, setMobileScreen] = useState<"list" | "thread">("list");

  useEffect(() => {
    if (desktop) setMobileScreen("list");
  }, [desktop]);

  const filteredChats = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return chats.filter((chat) => matchesLens(chat, lens) && (!normalizedQuery || `${chat.name} ${chat.preview}`.toLowerCase().includes(normalizedQuery)));
  }, [chats, lens, query]);

  const lensCount = (targetLens: PrototypeLens): number => chats.filter((chat) => matchesLens(chat, targetLens)).length;
  const selectChat = (chatId: string): void => {
    onSelectChat(chatId);
    if (!desktop) setMobileScreen("thread");
  };

  const inbox = (
    <View style={[styles.inbox, { backgroundColor: theme.background, borderColor: theme.divider }]}>
      <View style={styles.inboxHeader}>
        <View>
          <Text style={[styles.inboxTitle, { color: theme.text }]}>Messages</Text>
          <Text style={[styles.inboxSubtitle, { color: theme.textSecondary }]}>{lens === "all" ? "All conversations" : RAIL_ITEMS.find((item) => item.lens === lens)?.label}</Text>
        </View>
        <Pressable accessibilityLabel="Compose new message" style={[styles.composeButton, { backgroundColor: theme.accent }]}>
          <Ionicons name="create-outline" size={18} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={[styles.searchWrap, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {query.length > 0 && (
          <Pressable accessibilityLabel="Clear search" onPress={() => setQuery("")}>
            <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>
      <ChatList chats={filteredChats} selectedChatId={selectedChatId} onSelectChat={selectChat} mobile={!desktop} />
    </View>
  );

  if (!desktop) {
    return (
      <View style={[styles.mobileShell, { backgroundColor: theme.background }]}>
        {mobileScreen === "list" ? (
          inbox
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.mobileThread}>
            <Thread chat={chats.find((chat) => chat.id === selectedChatId)} messages={messages} onBack={() => setMobileScreen("list")} mobile />
          </KeyboardAvoidingView>
        )}
        {mobileScreen === "list" && (
          <View style={[styles.bottomRail, { backgroundColor: theme.background, borderTopColor: theme.divider }]}>
            {RAIL_ITEMS.map((item) => (
              <RailButton key={item.lens} item={item} active={lens === item.lens} count={lensCount(item.lens)} compact onPress={() => setLens(item.lens)} />
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.desktopShell, { backgroundColor: theme.background }]}>
      <View style={[styles.rail, { backgroundColor: theme.background, borderRightColor: theme.divider }]}>
        <View style={styles.railBrand}>
          <View style={[styles.railMark, { backgroundColor: theme.accent }]} />
        </View>
        <View style={styles.railItems}>
          {RAIL_ITEMS.map((item) => (
            <RailButton key={item.lens} item={item} active={lens === item.lens} count={lensCount(item.lens)} onPress={() => setLens(item.lens)} />
          ))}
        </View>
        <Pressable accessibilityLabel="Settings" style={styles.railSettings}>
          <Ionicons name="settings-outline" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>
      {inbox}
      <Thread chat={chats.find((chat) => chat.id === selectedChatId)} messages={messages} onBack={() => undefined} mobile={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  desktopShell: { flex: 1, flexDirection: "row", minHeight: 0 },
  mobileShell: { flex: 1, minHeight: 0 },
  mobileThread: { flex: 1, minHeight: 0 },
  rail: { width: 78, borderRightWidth: StyleSheet.hairlineWidth, paddingVertical: 16, alignItems: "center" },
  railBrand: { height: 38, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  railMark: { width: 11, height: 11, borderRadius: 3, transform: [{ rotate: "45deg" }] },
  railItems: { width: "100%", gap: 4 },
  railItem: { width: "100%", minHeight: 58, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 10 },
  railLabel: { fontSize: 10, fontWeight: "600" },
  railBadge: { position: "absolute", top: -3, right: -6, width: 6, height: 6, borderRadius: 3 },
  railSettings: { marginTop: "auto", padding: 10 },
  inbox: { width: 318, minWidth: 260, maxWidth: 390, borderRightWidth: StyleSheet.hairlineWidth, flex: 1 },
  inboxHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 },
  inboxTitle: { fontSize: 25, fontWeight: "700", letterSpacing: -0.5 },
  inboxSubtitle: { fontSize: 12, marginTop: 2 },
  composeButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  searchWrap: { height: 34, marginHorizontal: 14, marginBottom: 10, borderRadius: 9, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: Platform.select({ web: 7, default: 0 }) },
  chatScroll: { paddingBottom: 16 },
  section: { marginBottom: 12 },
  sectionLabel: { fontSize: 10, letterSpacing: 0.8, fontWeight: "700", paddingHorizontal: 18, paddingTop: 8, paddingBottom: 5 },
  chatRow: { minHeight: 59, paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  chatRowMobile: { minHeight: 70, paddingHorizontal: 16, paddingVertical: 11, gap: 12 },
  avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { color: "#FFFFFF", fontWeight: "700" },
  chatRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  chatRowTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  chatName: { flex: 1, minWidth: 0, fontSize: 14 },
  chatTime: { fontSize: 11, flexShrink: 0 },
  chatRowBottom: { flexDirection: "row", alignItems: "center", gap: 7 },
  chatPreview: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16 },
  unreadCount: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  unreadCountText: { color: "#FFFFFF", fontWeight: "700", fontSize: 10 },
  thread: { flex: 2, minWidth: 0 },
  emptyThread: { flex: 2, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 13 },
  threadHeader: { minHeight: 64, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  threadIdentity: { flexDirection: "row", alignItems: "center", gap: 9 },
  threadName: { fontSize: 15, fontWeight: "700" },
  threadMeta: { fontSize: 11, marginTop: 1 },
  infoButton: { padding: 6 },
  backButton: { flexDirection: "row", alignItems: "center", marginLeft: -8, marginRight: 5, paddingVertical: 7 },
  backText: { fontSize: 16, marginLeft: -4 },
  messageScroll: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 18, paddingVertical: 20, gap: 10 },
  dayLabel: { alignSelf: "center", fontSize: 10, fontWeight: "700", letterSpacing: 0.7, marginBottom: 4 },
  messageGroup: { maxWidth: "78%", gap: 3 },
  messageMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { fontSize: 11, marginLeft: 3 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 17 },
  messageText: { fontSize: 15, lineHeight: 20 },
  messageTime: { fontSize: 10, marginHorizontal: 3 },
  reaction: { fontSize: 12, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 9, marginTop: -7, marginRight: 2 },
  composer: { minHeight: 57, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  composerPlus: { padding: 2 },
  composerInput: { flex: 1, minHeight: 34, borderRadius: 17, paddingHorizontal: 12, fontSize: 15, paddingVertical: Platform.select({ web: 7, default: 5 }) },
  sendButton: { padding: 1 },
  bottomRail: { height: 62, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 3 },
  bottomRailItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 8, marginVertical: 4 },
  bottomRailLabel: { fontSize: 9, fontWeight: "600" },
});
