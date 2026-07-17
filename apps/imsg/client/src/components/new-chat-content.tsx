import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";
import type { Contact } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";

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

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {selected.length > 0 && (
        <View style={styles.chips}>
          {selected.map((contact) => (
            <Pressable
              key={contact.address}
              onPress={() =>
                setSelected((current) => current.filter((c) => c.address !== contact.address))
              }
              style={[styles.chip, { backgroundColor: theme.backgroundElement }]}
            >
              <Text style={{ color: theme.text, fontSize: 14 }}>{contact.name} ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search contacts, or type a number/email"
        placeholderTextColor={theme.textSecondary}
        autoFocus
        onSubmitEditing={() => {
          const value = query.trim();
          if (value && results.length === 0) {
            setSelected((current) =>
              current.some((c) => c.address === value)
                ? current
                : [...current, { address: value, name: value }],
            );
            setQuery("");
          }
        }}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <FlatList
        data={results}
        keyExtractor={(contact) => `${contact.address}-${contact.name}`}
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0, maxHeight: 240 }}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: theme.backgroundElement },
            ]}
            onPress={() => {
              setSelected((current) =>
                current.some((c) => c.address === item.address) ? current : [...current, item],
              );
              setQuery("");
            }}
          >
            <Text style={[styles.rowTitle, { color: theme.text }]}>{item.name}</Text>
            <Text style={[styles.rowSub, { color: theme.textSecondary }]}>{item.address}</Text>
          </Pressable>
        )}
      />
      <View style={styles.footer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="First message"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Pressable
          onPress={() => void create()}
          disabled={selected.length === 0 || !text.trim() || sending}
          style={[
            styles.sendButton,
            {
              backgroundColor:
                selected.length > 0 && text.trim() ? theme.bubbleMine : theme.backgroundElement,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Send</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  chip: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  input: {
    margin: 12,
    marginBottom: 0,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 17,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSub: {
    fontSize: 13,
  },
  footer: {
    marginTop: "auto",
    paddingBottom: 12,
  },
  sendButton: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
});
