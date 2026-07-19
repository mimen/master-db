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

const LENSES: readonly { id: PrototypeLens; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reply", label: "Needs Reply" },
  { id: "unread", label: "Unread" },
  { id: "waiting", label: "Waiting" },
  { id: "groups", label: "Groups" },
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

function Avatar({ chat, size = 42 }: { chat: PrototypeChat; size?: number }): React.JSX.Element {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: chat.avatarColor }]}>
      <Text style={{ color: "#FFFFFF", fontSize: size * 0.34, fontWeight: "700" }}>{chat.initials}</Text>
    </View>
  );
}

function LensControl({
  activeLens,
  open,
  onToggle,
  onSelect,
  color,
  mutedColor,
  backgroundColor,
}: {
  activeLens: PrototypeLens;
  open: boolean;
  onToggle: () => void;
  onSelect: (lens: PrototypeLens) => void;
  color: string;
  mutedColor: string;
  backgroundColor: string;
}): React.JSX.Element {
  const active = LENSES.find((lens) => lens.id === activeLens) ?? LENSES[0];

  return (
    <View style={styles.lensControl}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose inbox lens"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={[styles.lensButton, { backgroundColor }]}
      >
        <Text style={{ color, fontSize: 14, fontWeight: "600" }}>{active.label}</Text>
        <Ionicons name="chevron-down" size={14} color={mutedColor} />
      </Pressable>
      {open && (
        <View style={[styles.lensMenu, { backgroundColor, borderColor: "rgba(128,128,128,0.18)" }]}>
          {LENSES.map((lens) => {
            const selected = lens.id === activeLens;
            return (
              <Pressable
                key={lens.id}
                accessibilityRole="button"
                onPress={() => onSelect(lens.id)}
                style={styles.lensOption}
              >
                <Text style={{ color: selected ? color : mutedColor, fontSize: 14, fontWeight: selected ? "600" : "400" }}>
                  {lens.label}
                </Text>
                {selected && <Ionicons name="checkmark" size={16} color={color} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function ConversationRow({
  chat,
  selected,
  showPriority,
  onPress,
  textColor,
  mutedColor,
  dividerColor,
  selectedColor,
}: {
  chat: PrototypeChat;
  selected: boolean;
  showPriority: boolean;
  onPress: () => void;
  textColor: string;
  mutedColor: string;
  dividerColor: string;
  selectedColor: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${chat.name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: dividerColor, backgroundColor: selected ? selectedColor : "transparent" },
        pressed && { opacity: 0.66 },
      ]}
    >
      <Avatar chat={chat} />
      <View style={styles.rowBody}>
        <View style={styles.rowTopline}>
          <View style={styles.nameLine}>
            {showPriority && <View style={styles.priorityDot} />}
            <Text numberOfLines={1} style={{ flexShrink: 1, color: textColor, fontSize: 16, fontWeight: chat.unreadCount > 0 ? "700" : "500" }}>
              {chat.name}
            </Text>
          </View>
          <Text style={{ color: chat.unreadCount > 0 ? textColor : mutedColor, fontSize: 12, fontWeight: chat.unreadCount > 0 ? "600" : "400" }}>
            {chat.time}
          </Text>
        </View>
        <View style={styles.previewLine}>
          <Text numberOfLines={1} style={{ flex: 1, color: mutedColor, fontSize: 14, fontWeight: chat.unreadCount > 0 ? "500" : "400" }}>
            {chat.preview}
          </Text>
          {chat.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{chat.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function Inbox({
  chats,
  selectedChatId,
  onSelectChat,
  lens,
  onChangeLens,
  query,
  onChangeQuery,
  color,
  mutedColor,
  backgroundColor,
  elementColor,
  dividerColor,
  selectedColor,
}: {
  chats: readonly PrototypeChat[];
  selectedChatId: string;
  onSelectChat: (chatId: string) => void;
  lens: PrototypeLens;
  onChangeLens: (lens: PrototypeLens) => void;
  query: string;
  onChangeQuery: (query: string) => void;
  color: string;
  mutedColor: string;
  backgroundColor: string;
  elementColor: string;
  dividerColor: string;
  selectedColor: string;
}): React.JSX.Element {
  const [lensOpen, setLensOpen] = useState(false);
  const visibleChats = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return chats.filter((chat) => matchesLens(chat, lens) && (normalizedQuery === "" || `${chat.name} ${chat.preview}`.toLowerCase().includes(normalizedQuery)));
  }, [chats, lens, query]);

  return (
    <View style={[styles.inbox, { backgroundColor }]}>
      <View style={styles.inboxHeader}>
        <View style={styles.titleLine}>
          <Text style={{ color, fontSize: 32, fontWeight: "700", letterSpacing: -0.7 }}>Messages</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Compose new message" style={styles.composeButton}>
            <Ionicons name="create-outline" size={24} color="#007AFF" />
          </Pressable>
        </View>
        <View style={styles.controlsLine}>
          <LensControl
            activeLens={lens}
            open={lensOpen}
            onToggle={() => setLensOpen((open) => !open)}
            onSelect={(nextLens) => {
              onChangeLens(nextLens);
              setLensOpen(false);
            }}
            color={color}
            mutedColor={mutedColor}
            backgroundColor={elementColor}
          />
          <Text style={{ color: mutedColor, fontSize: 13 }}>{visibleChats.length} conversations</Text>
        </View>
        <View style={[styles.search, { backgroundColor: elementColor }]}>
          <Ionicons name="search" size={17} color={mutedColor} />
          <TextInput
            accessibilityLabel="Search conversations"
            value={query}
            onChangeText={onChangeQuery}
            onFocus={() => setLensOpen(false)}
            placeholder="Search"
            placeholderTextColor={mutedColor}
            selectionColor="#007AFF"
            style={[styles.searchInput, { color }]}
          />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {visibleChats.map((chat) => (
          <ConversationRow
            key={chat.id}
            chat={chat}
            selected={chat.id === selectedChatId}
            showPriority={lens === "all" && chat.attention === "reply"}
            onPress={() => {
              setLensOpen(false);
              onSelectChat(chat.id);
            }}
            textColor={color}
            mutedColor={mutedColor}
            dividerColor={dividerColor}
            selectedColor={selectedColor}
          />
        ))}
        {visibleChats.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={28} color={mutedColor} />
            <Text style={{ color: mutedColor, fontSize: 15 }}>Nothing in this lens.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Thread({
  chat,
  messages,
  onBack,
  showBack,
  color,
  mutedColor,
  backgroundColor,
  elementColor,
  dividerColor,
  mineColor,
}: {
  chat: PrototypeChat | undefined;
  messages: readonly PrototypeMessage[];
  onBack: () => void;
  showBack: boolean;
  color: string;
  mutedColor: string;
  backgroundColor: string;
  elementColor: string;
  dividerColor: string;
  mineColor: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const threadMessages = useMemo(() => messages.filter((message) => message.chatId === chat?.id), [chat?.id, messages]);

  if (!chat) {
    return (
      <View style={[styles.emptyThread, { backgroundColor }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={34} color={mutedColor} />
        <Text style={{ color, fontSize: 18, fontWeight: "600", marginTop: 12 }}>Select a conversation</Text>
        <Text style={{ color: mutedColor, fontSize: 14, marginTop: 4 }}>Your messages stay quietly out of the way.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.thread, { backgroundColor }]}
      behavior={showBack && Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.threadHeader, { borderBottomColor: dividerColor }]}>
        {showBack && (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations" onPress={onBack} hitSlop={10} style={styles.backButton}>
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
            <Text style={styles.backText}>Messages</Text>
          </Pressable>
        )}
        <View style={[styles.threadIdentity, !showBack && styles.threadIdentityWide]}>
          <Avatar chat={chat} size={30} />
          <View style={{ minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color, fontSize: 16, fontWeight: "700" }}>{chat.name}</Text>
            <Text style={{ color: mutedColor, fontSize: 12 }}>{chat.isGroup ? `${chat.participants} people` : "iMessage"}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Conversation information" style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={23} color="#007AFF" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled">
        <Text style={{ color: mutedColor, fontSize: 12, textAlign: "center", marginBottom: 12 }}>Today</Text>
        {threadMessages.map((message) => (
          <View key={message.id} style={[styles.messageWrap, message.fromMe ? styles.mineWrap : styles.theirWrap]}>
            {!message.fromMe && message.sender && chat.isGroup && <Text style={{ color: mutedColor, fontSize: 11, marginLeft: 4, marginBottom: 2 }}>{message.sender}</Text>}
            <View style={[styles.messageBubble, { backgroundColor: message.fromMe ? mineColor : elementColor }]}>
              <Text style={{ color: message.fromMe ? "#FFFFFF" : color, fontSize: 16, lineHeight: 21 }}>{message.text}</Text>
            </View>
            <View style={styles.messageMeta}>
              <Text style={{ color: mutedColor, fontSize: 11 }}>{message.time}</Text>
              {message.reaction && <Text style={{ fontSize: 12 }}>{message.reaction}</Text>}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.composer, { borderTopColor: dividerColor, backgroundColor }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" style={[styles.addButton, { backgroundColor: elementColor }]}>
          <Ionicons name="add" size={22} color="#007AFF" />
        </Pressable>
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder="iMessage"
          placeholderTextColor={mutedColor}
          selectionColor="#007AFF"
          style={[styles.composerInput, { backgroundColor: elementColor, color }]}
        />
        {draft.length > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={() => setDraft("")} style={styles.sendButton}>
            <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export function FocusLens({ chats, messages, selectedChatId, onSelectChat }: PrototypeDesignProps): React.JSX.Element {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= 768;
  const [lens, setLens] = useState<PrototypeLens>("all");
  const [query, setQuery] = useState("");
  const [mobileChatId, setMobileChatId] = useState<string | null>(null);
  const activeChatId = desktop ? selectedChatId : mobileChatId;
  const activeChat = chats.find((chat) => chat.id === activeChatId);

  const selectChat = (chatId: string): void => {
    onSelectChat(chatId);
    if (!desktop) setMobileChatId(chatId);
  };
  const leaveThread = (): void => setMobileChatId(null);

  const inbox = (
    <Inbox
      chats={chats}
      selectedChatId={selectedChatId}
      onSelectChat={selectChat}
      lens={lens}
      onChangeLens={setLens}
      query={query}
      onChangeQuery={setQuery}
      color={theme.text}
      mutedColor={theme.textSecondary}
      backgroundColor={theme.background}
      elementColor={theme.backgroundElement}
      dividerColor={theme.divider}
      selectedColor={theme.backgroundSelected}
    />
  );
  const thread = (
    <Thread
      key={activeChat?.id ?? "empty"}
      chat={activeChat}
      messages={messages}
      onBack={leaveThread}
      showBack={!desktop}
      color={theme.text}
      mutedColor={theme.textSecondary}
      backgroundColor={theme.background}
      elementColor={theme.backgroundElement}
      dividerColor={theme.divider}
      mineColor={theme.bubbleMine}
    />
  );

  if (!desktop) return <View style={styles.shell}>{activeChat ? thread : inbox}</View>;

  return (
    <View style={[styles.shell, styles.desktopShell, { backgroundColor: theme.background }]}>
      <View style={[styles.desktopInbox, { borderRightColor: theme.divider }]}>{inbox}</View>
      <View style={styles.desktopThread}>{thread}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  desktopShell: { flexDirection: "row" },
  desktopInbox: { width: 360, borderRightWidth: StyleSheet.hairlineWidth },
  desktopThread: { flex: 1, minWidth: 0 },
  inbox: { flex: 1 },
  inboxHeader: { zIndex: 2, elevation: 2, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8, gap: 13 },
  titleLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  composeButton: { padding: 4 },
  controlsLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 2 },
  lensControl: { position: "relative" },
  lensButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 9, paddingHorizontal: 10 },
  lensMenu: { position: "absolute", top: 38, left: 0, width: 156, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingVertical: 4, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  lensOption: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 11 },
  search: { height: 36, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, height: "100%", fontSize: 16, paddingVertical: 0 },
  listContent: { paddingBottom: 12 },
  row: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  nameLine: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  priorityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FF9F0A" },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, backgroundColor: "#007AFF" },
  unreadText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  emptyState: { alignItems: "center", gap: 9, paddingTop: 64 },
  thread: { flex: 1 },
  threadHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  backButton: { flexDirection: "row", alignItems: "center", marginLeft: -8, marginRight: 5 },
  backText: { color: "#007AFF", fontSize: 16, marginLeft: -4 },
  threadIdentity: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  threadIdentityWide: { justifyContent: "flex-start" },
  infoButton: { padding: 5 },
  messageList: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 14, paddingTop: 22, paddingBottom: 14 },
  messageWrap: { marginBottom: 10, maxWidth: "80%" },
  mineWrap: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirWrap: { alignSelf: "flex-start", alignItems: "flex-start" },
  messageBubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  messageMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, marginHorizontal: 4 },
  composer: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  addButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  composerInput: { flex: 1, minHeight: 36, maxHeight: 88, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7, fontSize: 16 },
  sendButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#007AFF" },
  emptyThread: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
});
