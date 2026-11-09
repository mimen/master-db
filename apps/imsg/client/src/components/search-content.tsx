import type { api as convexApi } from "@convex-api";
import { addressesMatch } from "@shared/address";
import { PROFILES } from "@shared/platform-profile";
import type { Contact, ConversationId, Platform } from "@shared/types";
import { useConvexAuth, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ListRow } from "./list-row";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useTheme } from "@/hooks/use-theme";
import { api, type SearchHit } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import { conversationRoute, selectChat } from "@/lib/selection";

const accountsApi = anyApi.comma.accounts as unknown as typeof convexApi.comma.accounts;

type SearchRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "contact"; key: string; contact: Contact }
  | { kind: "message"; key: string; message: SearchHit };

/** Search UI shared by the mobile route and the desktop overlay panel. */
export function SearchContent({
  initialQuery,
  scopeConversation,
  scopeLabel,
  onClose,
}: {
  initialQuery?: string;
  /** When set, search only this conversation (in-thread search). */
  scopeConversation?: ConversationId;
  scopeLabel?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState(initialQuery ?? "");

  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const directory = useChatDirectory();
  const { isAuthenticated } = useConvexAuth();
  // Mail is not in the Messages directory, so a connected mailbox offers Gmail by its account.
  const mailbox = useQuery(accountsApi.listAccounts, isAuthenticated && !scopeConversation ? {} : "skip")
    ?.some((account) => account.platform === "gmail" && account.connected);
  // Offered only once there is a second platform to search, and never inside one conversation.
  const platforms = scopeConversation ? []
    : [...new Set([...(directory ?? []).map((chat) => chat.route.platform), ...(mailbox ? ["gmail" as const] : [])])];
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setContacts([]);
      setMessages([]);
      return;
    }
    // A search still in flight when the query changes lands nothing: an older query never overwrites a newer one.
    let current = true;
    const handle = setTimeout(() => {
      setSearching(true);
      Promise.all([
        api.search(query.trim(), scopeConversation ? { conversationId: scopeConversation } : platform ? { platform } : {}).catch(() => []),
        scopeConversation || platform ? Promise.resolve([]) : api.contacts(query.trim()).catch(() => []),
      ])
        .then(([messageResults, contactResults]) => {
          if (!current) return;
          setMessages(messageResults);
          setContacts(contactResults.slice(0, 6));
        })
        .finally(() => current && setSearching(false));
    }, 350);
    return () => {
      current = false;
      clearTimeout(handle);
    };
  }, [query, scopeConversation, platform]);

  const open = (conversationId: ConversationId, name: string) => {
    onClose();
    if (!selectChat({ conversationId, name })) router.push(conversationRoute(conversationId));
  };
  const openContact = (contact: Contact) => {
    // A listed 1:1 opens on the tap; findChat resolves the rest.
    const listed = directory?.find((chat) => !chat.isGroup && chat.participants.length === 1
      && addressesMatch(chat.participants[0]!.address, contact.address));
    if (listed) return open(listed.conversationId, contact.name);
    api
      .findChat(contact.address)
      .then(({ conversationId }) => open(conversationId, contact.name))
      .catch(() => undefined);
  };

  const openMessage = (message: SearchHit) => {
    onClose();
    if (message.platform === "gmail") {
      router.push({ pathname: "/mail", params: { thread: message.conversationId } });
      return;
    }
    const jumpTarget = { guid: message.guid, dateCreated: message.dateCreated };
    if (!selectChat({ conversationId: message.conversationId, jumpTarget })) router.push(conversationRoute(message.conversationId, jumpTarget));
  };

  const rows: SearchRow[] = [
    ...(contacts.length > 0
      ? [
          { kind: "header", key: "h-contacts", label: "Contacts" } as const,
          ...contacts.map(
            (contact) =>
              ({ kind: "contact", key: `c-${contact.address}-${contact.name}`, contact }) as const,
          ),
        ]
      : []),
    ...(messages.length > 0
      ? [
          { kind: "header", key: "h-messages", label: "Messages" } as const,
          ...messages.map((message) => ({ kind: "message", key: message.guid, message }) as const),
        ]
      : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={scopeLabel ? `Search in ${scopeLabel}` : "Search contacts and messages…"}
        placeholderTextColor={theme.textTertiary}
        autoFocus
        style={[styles.input, { color: theme.text, backgroundColor: theme.field }]}
      />
      {platforms.length > 1 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Search in" style={styles.platforms}>
          {[null, ...platforms].map((value) => {
            const selected = platform === value;
            return (
              <Pressable
                key={value ?? "all"}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setPlatform(value)}
                style={[styles.platform, { borderColor: theme.divider }, selected && { backgroundColor: theme.accent, borderColor: theme.accent }]}
              >
                <Text style={[styles.platformLabel, { color: selected ? theme.onAccent : theme.textSecondary }]}>
                  {value ? PROFILES[value].name : "Everywhere"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length >= 2 ? (
            searching ? (
              <Text style={[styles.emptyDetail, styles.emptyBlock, { color: theme.textSecondary }]}>Searching…</Text>
            ) : (
              <View style={styles.emptyBlock}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No results for “{query.trim()}”</Text>
                <Text style={[styles.emptyDetail, { color: theme.textSecondary }]}>
                  {scopeLabel ? `Searched every message in ${scopeLabel}.` : "Searched contacts and the text of every message."}
                </Text>
              </View>
            )
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return (
              <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>
                {item.label}
              </Text>
            );
          }
          if (item.kind === "contact") {
            return (
              <ListRow
                onPress={() => openContact(item.contact)}
                title={item.contact.name}
                subtitle={item.contact.address}
              />
            );
          }
          const m = item.message;
          return (
            <Pressable
              style={({ hovered, pressed }) => [
                styles.row,
                hovered && !pressed && { backgroundColor: theme.rowHover },
                pressed && { backgroundColor: theme.rowSelected },
              ]}
              onPress={() => openMessage(m)}
            >
              <View style={styles.messageTop}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>
                  {m.isFromMe ? "You" : (m.sender?.name ?? m.sender?.address ?? "?")}
                </Text>
                <Text style={[styles.rowSub, { color: theme.textTertiary }]}>
                  {formatListTimestamp(m.dateCreated)}
                </Text>
              </View>
              <Text numberOfLines={2} style={[styles.rowSub, { color: theme.textSecondary }]}>
                {m.text}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  platforms: { flexDirection: "row", gap: 6, marginHorizontal: 16, marginBottom: 6 },
  platform: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 4 },
  platformLabel: { fontSize: 12.5, fontWeight: "600" },
  input: {
    margin: 12,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  sectionHeader: {
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSub: {
    fontSize: 14,
    marginTop: 1,
  },
  messageTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  emptyBlock: {
    alignItems: "center",
    gap: 6,
    marginTop: 64,
    paddingHorizontal: 22,
  },
  emptyTitle: {
    fontSize: 13.5,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyDetail: {
    fontSize: 12.5,
    lineHeight: 17.5,
    textAlign: "center",
  },
});
