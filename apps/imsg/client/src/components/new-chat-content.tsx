import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";
import type { ChatSummary, Contact } from "@shared/types";
import { formatAddress } from "@shared/address";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { contactService, splitPrefix } from "@/lib/contact-service";
import { HOVER_DIM, PRESS_DIM } from "@/constants/theme";
import { type AirtableHumanRow } from "@/lib/identity";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { PersonAvatar } from "./avatar";
import { ServiceDot, ServiceLabel } from "./service-label";
import { useTheme } from "@/hooks/use-theme";
import type { ThemeColors } from "@/components/ui/interaction";

type Row =
  | { kind: "recent-header"; key: string }
  | { kind: "contact"; key: string; contact: Contact }
  | { kind: "airtable-header"; key: string }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

const RECENT_LIMIT = 8;

/** People from the most recent one-to-one conversations, newest first. */
function recentContacts(chats: readonly ChatSummary[] | null): Contact[] {
  if (!chats) return [];
  return [...chats]
    .filter((chat) => !chat.isGroup && chat.participants[0])
    .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0))
    .slice(0, RECENT_LIMIT)
    .map((chat) => ({ address: chat.participants[0]!.address, name: chat.displayName }));
}

/** New-message UI shared by the mobile route and the desktop overlay panel. */
export function NewChatContent({
  onClose,
  initialContact,
}: {
  onClose: () => void;
  /** Pre-fills the recipient — used by the person-view's "Message" action for someone with no existing thread. */
  initialContact?: Contact;
}) {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const [activeIndex, setActiveIndex] = useState(0);
  const toInput = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact[]>(initialContact ? [initialContact] : []);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const needle = query.trim();
  const chats = useChatDirectory();
  const recents = useMemo(() => recentContacts(chats), [chats]);

  useEffect(() => {
    if (needle.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.contacts(needle).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [needle]);

  const addContact = (c: Contact) => {
    setSelected((current) => (current.some((x) => x.address === c.address) ? current : [...current, c]));
    setQuery("");
    toInput.current?.focus();
  };


  // Same pattern as the Contacts screen: existing contacts first, unlinked
  // Airtable matches below — sharing the search/dedupe/add logic via the hook.
  const { results: airtableResults, add: addAirtableContact, addingId } = useAirtableSearch(needle, (_personId, human) => {
    const address = human.phone ?? human.email;
    if (address) addContact({ address, name: human.display_name });
  });

  const showRecents = needle.length === 0;
  const unselectedRecents = recents.filter((c) => !selected.some((x) => x.address === c.address));
  const rows: Row[] = showRecents ? [
    ...(unselectedRecents.length > 0 ? [{ kind: "recent-header" as const, key: "recent-header" }] : []),
    ...unselectedRecents.map((c) => ({ kind: "contact" as const, key: `recent-${c.address}`, contact: c })),
  ] : [
    ...results.map((c) => ({ kind: "contact" as const, key: `${c.address}-${c.name}`, contact: c })),
    ...(airtableResults.length > 0
      ? [
          { kind: "airtable-header" as const, key: "airtable-header" },
          ...airtableResults.map((h) => ({ kind: "airtable" as const, key: `at-${h.record_id}`, human: h })),
        ]
      : []),
  ];

  const create = async () => {
    if (selected.length === 0 || !text.trim() || sending) return;
    setSending(true);
    try {
      const { chatGuid } = await runCommand(null, {
        kind: "createChat",
        addresses: selected.map((c) => c.address),
        text: text.trim(),
      });
      onClose();
      if (!selectChat({ guid: chatGuid })) {
        router.push({ pathname: "/chat/[guid]", params: { guid: chatGuid } });
      }
    } catch (e) {
      // Surface the server's reason when it gives one — a bare toast made
      // the group-creation failure (apple-script vs private-api) opaque.
      const detail =
        e instanceof Error ? /"error"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] : undefined;
      showToast(messagingCommandError(e, detail ? `Couldn't start: ${detail.slice(0, 120)}` : e instanceof Error ? `Couldn't start: ${e.message.slice(0, 120)}` : "Couldn't start the conversation"));
    } finally {
      setSending(false);
    }
  };

  const canSend = selected.length > 0 && text.trim().length > 0;
  const pickable = rows.filter((row) => row.kind === "contact" || row.kind === "airtable");
  const active = pickable.length > 0 ? pickable[Math.min(activeIndex, pickable.length - 1)] : undefined;
  const pick = (row: Row): void => {
    if (row.kind === "contact") addContact(row.contact);
    else if (row.kind === "airtable") void addAirtableContact(row.human);
  };
  const onKey = (key: string): boolean => {
    if (pickable.length === 0) return false;
    if (key === "ArrowDown") setActiveIndex((i) => (i + 1) % pickable.length);
    else if (key === "ArrowUp") setActiveIndex((i) => (i - 1 + pickable.length) % pickable.length);
    else return false;
    return true;
  };

  const suggestions = rows.length > 0 ? (
    <View
      style={[
        wide ? styles.popover : styles.inlineList,
        wide && { backgroundColor: theme.popBg, boxShadow: theme.popShadow } as object,
      ]}
    >
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          if (item.kind === "airtable-header" || item.kind === "recent-header") {
            return (
              <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>
                {item.kind === "recent-header" ? "Recent" : "From Airtable"}
              </Text>
            );
          }
          const selectedRow = item === active;
          if (item.kind === "airtable") {
            const adding = addingId === item.human.record_id;
            return (
              <SuggestionRow
                selected={selectedRow}
                disabled={adding}
                onPress={() => pick(item)}
                theme={theme}
                avatar={<PersonAvatar address={null} name={item.human.display_name} size={28} />}
                name={item.human.display_name}
                query={needle}
                handle={item.human.phone ?? item.human.email ?? undefined}
                trailing={adding ? <ActivityIndicator size="small" /> : <Ionicons name="add-circle-outline" size={18} color={theme.icon} />}
              />
            );
          }
          const service = contactService(item.contact.address, chats);
          const handle = formatAddress(item.contact.address);
          return (
            <SuggestionRow
              selected={selectedRow}
              onPress={() => pick(item)}
              theme={theme}
              avatar={<PersonAvatar address={item.contact.address} name={item.contact.name} size={28} />}
              name={item.contact.name}
              query={needle}
              handle={item.contact.name === handle ? undefined : handle}
              trailing={service ? <ServiceLabel service={service} size={12} /> : undefined}
            />
          );
        }}
      />
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.thread }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {wide && (
        <View style={[styles.header, { borderBottomColor: theme.divider }]}>
          <Text accessibilityRole="header" style={[styles.headerTitle, { color: theme.text }]}>New message</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close new message"
            onPress={onClose}
            hitSlop={8}
            style={({ hovered, pressed }) => [styles.headerIcon, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
          >
            <Ionicons name="close" size={18} color={theme.icon} />
          </Pressable>
        </View>
      )}
      <View style={[styles.toRow, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.toLabel, { color: theme.textTertiary }]}>To</Text>
        {selected.map((contact) => {
          const service = contactService(contact.address, chats);
          return (
            <Pressable
              key={contact.address}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${contact.name}`}
              onPress={() => setSelected((cur) => cur.filter((c) => c.address !== contact.address))}
              style={({ hovered, pressed }) => [styles.token, { backgroundColor: hovered || pressed ? theme.rowHover : theme.surface, borderColor: theme.dividerStrong }]}
            >
              <PersonAvatar address={contact.address} name={contact.name} size={18} />
              <Text numberOfLines={1} style={[styles.tokenText, { color: theme.text }]}>{contact.name}</Text>
              {service && <ServiceDot service={service} />}
            </Pressable>
          );
        })}
        <TextInput
          ref={toInput}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setActiveIndex(0);
          }}
          placeholder={selected.length === 0 ? "Name, number, or email" : ""}
          placeholderTextColor={theme.textTertiary}
          autoFocus
          // react-native-web reads blurOnSubmit, not submitBehavior; Enter picks and keeps typing.
          blurOnSubmit={false}
          onKeyPress={(event) => {
            if (onKey(event.nativeEvent.key)) event.preventDefault();
          }}
          onSubmitEditing={() => {
            if (active) pick(active);
            else {
              const value = query.trim();
              if (value) addContact({ address: value, name: value });
            }
          }}
          style={[styles.toInput, { color: theme.text }]}
        />
      </View>

      <View style={{ flex: 1 }}>{suggestions}</View>

      <View style={styles.composerWrap}>
        <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={theme.textTertiary}
            multiline
            style={[styles.msgInput, { color: theme.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => void create()}
            disabled={!canSend || sending}
            style={({ hovered, pressed }) => [styles.sendButton, { backgroundColor: canSend ? theme.bubbleMine : theme.field }, canSend && !sending && hovered && !pressed && { opacity: HOVER_DIM }, canSend && !sending && pressed && { opacity: PRESS_DIM }]}
          >
            {sending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={16} color={canSend ? "#FFFFFF" : theme.icon} />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function SuggestionRow({
  avatar,
  name,
  query,
  handle,
  trailing,
  selected,
  disabled,
  theme,
  onPress,
}: {
  avatar: React.ReactNode;
  name: string;
  query: string;
  handle?: string;
  trailing?: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  theme: ThemeColors;
  onPress: () => void;
}) {
  const { match, rest } = splitPrefix(name, query);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      aria-selected={selected}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, pressed }) => [styles.suggestion, (selected || hovered || pressed) && { backgroundColor: selected ? theme.popSelected : theme.rowHover }]}
    >
      {avatar}
      <View style={styles.suggestionBody}>
        <Text numberOfLines={1} style={[styles.suggestionName, { color: theme.text }]}>
          {match ? <Text style={{ fontWeight: "700" }}>{match}</Text> : null}
          {rest}
        </Text>
        {handle ? <Text numberOfLines={1} style={[styles.suggestionHandle, { color: theme.textTertiary }]}>{handle}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 52, justifyContent: "space-between", paddingLeft: 22, paddingRight: 12 },
  headerTitle: { fontSize: 15.5, fontWeight: "600", letterSpacing: -0.15 },
  headerIcon: { alignItems: "center", borderRadius: 6, height: 28, justifyContent: "center", width: 28 },
  toRow: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", flexWrap: "wrap", gap: 6, minHeight: 52, paddingHorizontal: 22, paddingVertical: 10 },
  toLabel: { fontSize: 13.5, marginRight: 4 },
  token: { alignItems: "center", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, height: 26, maxWidth: 240, paddingLeft: 3, paddingRight: 9 },
  tokenText: { flexShrink: 1, fontSize: 13, fontWeight: "500" },
  toInput: { flex: 1, fontSize: 13.5, minWidth: 120, paddingVertical: 2 },
  popover: { borderRadius: 12, left: 62, maxHeight: 360, padding: 5, position: "absolute", top: 4, width: 420, zIndex: 2 },
  inlineList: { flex: 1, paddingHorizontal: 8, paddingTop: 4 },
  sectionHeader: { fontSize: 11.5, fontWeight: "600", paddingBottom: 4, paddingHorizontal: 10, paddingTop: 8 },
  suggestion: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 11, marginBottom: 2, minHeight: 48, paddingHorizontal: 10, paddingVertical: 6 },
  suggestionBody: { flex: 1, minWidth: 0 },
  suggestionName: { fontSize: 13.5, lineHeight: 17 },
  suggestionHandle: { fontSize: 12, fontVariant: ["tabular-nums"], lineHeight: 15 },
  composerWrap: { alignSelf: "center", maxWidth: 760, paddingBottom: 16, paddingHorizontal: 16, width: "100%" },
  composer: { alignItems: "flex-end", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 8, padding: 8, paddingLeft: 14 },
  msgInput: { flex: 1, fontSize: 14, lineHeight: 20, maxHeight: 120, minHeight: 40, paddingVertical: 10 },
  sendButton: { alignItems: "center", borderRadius: 15, height: 30, justifyContent: "center", marginBottom: 5, width: 30 },
});
