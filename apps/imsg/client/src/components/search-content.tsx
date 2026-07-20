import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import { selectChat } from "@/lib/selection";
import type { Contact, Message } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";

type SearchRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "contact"; key: string; contact: Contact }
  | { kind: "message"; key: string; message: Message };

/** Search UI shared by the mobile route and the desktop overlay panel. */
export function SearchContent({
  initialQuery,
  onClose,
}: {
  initialQuery?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState(initialQuery ?? "");

  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setContacts([]);
      setMessages([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      Promise.all([
        api.search(query.trim()).catch(() => []),
        api.contacts(query.trim()).catch(() => []),
      ])
        .then(([messageResults, contactResults]) => {
          setMessages(messageResults);
          setContacts(contactResults.slice(0, 6));
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const openContact = (contact: Contact) => {
    api
      .findChat(contact.address)
      .then(({ chatGuid }) => {
        onClose();
        if (!selectChat({ guid: chatGuid, name: contact.name })) {
          router.push({ pathname: "/chat/[guid]", params: { guid: chatGuid, name: contact.name } });
        }
      })
      .catch(() => undefined);
  };

  const openMessage = (message: Message) => {
    onClose();
    const jumpTarget = { guid: message.guid, dateCreated: message.dateCreated };
    if (!selectChat({ guid: message.chatGuid, jumpTarget })) {
      router.push({
        pathname: "/chat/[guid]",
        params: {
          guid: message.chatGuid,
          targetGuid: message.guid,
          targetDate: String(message.dateCreated),
        },
      });
    }
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
        placeholder="Search contacts and messages…"
        placeholderTextColor={theme.textSecondary}
        autoFocus
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length >= 2 ? (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              {searching ? "Searching…" : "No results"}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return (
              <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
                {item.label}
              </Text>
            );
          }
          if (item.kind === "contact") {
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: theme.backgroundElement },
                ]}
                onPress={() => openContact(item.contact)}
              >
                <Text style={[styles.rowTitle, { color: theme.text }]}>{item.contact.name}</Text>
                <Text style={[styles.rowSub, { color: theme.textSecondary }]}>
                  {item.contact.address}
                </Text>
              </Pressable>
            );
          }
          const m = item.message;
          return (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.backgroundElement },
              ]}
              onPress={() => openMessage(m)}
            >
              <View style={styles.messageTop}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>
                  {m.isFromMe ? "You" : (m.sender?.name ?? m.sender?.address ?? "?")}
                </Text>
                <Text style={[styles.rowSub, { color: theme.textSecondary }]}>
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
  input: {
    margin: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 17,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
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
  empty: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 15,
  },
});
