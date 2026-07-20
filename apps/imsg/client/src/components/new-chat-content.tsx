import { useEffect, useState } from "react";
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
import { selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";
import type { Contact } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";
import { initials } from "@/lib/format";

/** New-message UI shared by the mobile route and the desktop overlay panel. */
export function NewChatContent({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.contacts(query.trim()).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const addContact = (c: Contact) => {
    setSelected((current) => (current.some((x) => x.address === c.address) ? current : [...current, c]));
    setQuery("");
  };

  const create = async () => {
    if (selected.length === 0 || !text.trim() || sending) return;
    setSending(true);
    try {
      const { chatGuid } = await api.newChat({
        addresses: selected.map((c) => c.address),
        text: text.trim(),
      });
      onClose();
      if (!selectChat({ guid: chatGuid })) {
        router.push({ pathname: "/chat/[guid]", params: { guid: chatGuid } });
      }
    } catch {
      showToast("Couldn't start the conversation");
    } finally {
      setSending(false);
    }
  };

  const canSend = selected.length > 0 && text.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* To: field with inline recipient chips */}
      <View style={[styles.toRow, { borderBottomColor: theme.divider }]}>
        <Text style={{ color: theme.textSecondary, fontSize: 15 }}>To:</Text>
        <View style={styles.toContent}>
          {selected.map((contact) => (
            <Pressable
              key={contact.address}
              onPress={() => setSelected((cur) => cur.filter((c) => c.address !== contact.address))}
              style={[styles.chip, { backgroundColor: theme.accent }]}
            >
              <Text style={{ color: "#fff", fontSize: 14 }}>{contact.name}</Text>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          ))}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={selected.length === 0 ? "Name, number, or email" : ""}
            placeholderTextColor={theme.textSecondary}
            autoFocus
            onSubmitEditing={() => {
              const value = query.trim();
              if (value && results.length === 0) addContact({ address: value, name: value });
            }}
            style={[styles.toInput, { color: theme.text }]}
          />
        </View>
      </View>

      {/* Contact suggestions fill the middle; the keyboard just shrinks this. */}
      <FlatList
        data={results}
        keyExtractor={(contact) => `${contact.address}-${contact.name}`}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundElement }]}
            onPress={() => addContact(item)}
          >
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "600" }}>
                {initials(item.name)}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>{item.name}</Text>
              <Text style={[styles.rowSub, { color: theme.textSecondary }]}>{item.address}</Text>
            </View>
          </Pressable>
        )}
      />

      {/* Message composer sits at the bottom, always visible. */}
      <View style={[styles.composer, { borderTopColor: theme.divider }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="iMessage"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.msgInput, { color: theme.text, borderColor: theme.divider }]}
        />
        <Pressable
          onPress={() => void create()}
          disabled={!canSend || sending}
          style={[styles.sendButton, { backgroundColor: canSend ? theme.bubbleMine : theme.backgroundElement }]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="arrow-up" size={20} color="#fff" />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  toRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toContent: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toInput: {
    flex: 1,
    minWidth: 120,
    fontSize: 16,
    paddingVertical: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSub: {
    fontSize: 13,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  msgInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 17,
    maxHeight: 120,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
});
