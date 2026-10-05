import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import { selectChat } from "@/lib/selection";
import type { Contact, Message } from "@shared/types";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ListRow } from "./list-row";

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = {
  light: {
    sidebar: "#FFFFFF",
    field: "rgba(0,0,0,0.045)",
    rowHover: "rgba(0,0,0,0.04)",
    rowSelected: "rgba(0,0,0,0.075)",
    text: "#17171A",
    textSecondary: "#55555C",
    textTertiary: "#64646B",
  },
  dark: {
    sidebar: "#141416",
    field: "rgba(255,255,255,0.06)",
    rowHover: "rgba(255,255,255,0.045)",
    rowSelected: "rgba(255,255,255,0.085)",
    text: "#EDEDEF",
    textSecondary: "#A6A6AD",
    textTertiary: "#8F8F96",
  },
} as const;

type SearchRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "contact"; key: string; contact: Contact }
  | { kind: "message"; key: string; message: Message };

/** Search UI shared by the mobile route and the desktop overlay panel. */
export function SearchContent({
  initialQuery,
  scopeChatGuid,
  scopeLabel,
  onClose,
}: {
  initialQuery?: string;
  /** When set, search only this conversation (in-thread search). */
  scopeChatGuid?: string;
  scopeLabel?: string;
  onClose: () => void;
}) {
  const theme = SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
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
        api.search(query.trim(), scopeChatGuid ? { chat: scopeChatGuid } : {}).catch(() => []),
        scopeChatGuid ? Promise.resolve([]) : api.contacts(query.trim()).catch(() => []),
      ])
        .then(([messageResults, contactResults]) => {
          setMessages(messageResults);
          setContacts(contactResults.slice(0, 6));
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [query, scopeChatGuid]);

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
    <View style={{ flex: 1, backgroundColor: theme.sidebar }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={scopeLabel ? `Search in ${scopeLabel}` : "Search contacts and messages…"}
        placeholderTextColor={theme.textTertiary}
        autoFocus
        style={[styles.input, { color: theme.text, backgroundColor: theme.field }]}
      />
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
