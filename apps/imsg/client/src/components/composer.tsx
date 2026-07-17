import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/lib/api";
import { BASE_URL } from "@/lib/config";
import type { Message } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";

interface ComposerProps {
  chatGuid: string;
  replyTo: Message | null;
  editing: Message | null;
  onClearReply: () => void;
  onClearEditing: () => void;
  onEdited: (message: Message) => void;
  onOptimistic: (message: Message) => void;
  onSettled: (tempGuid: string, message: Message) => void;
  onSent: (message: Message) => void;
}

function tempMessage(chatGuid: string, text: string, replyTo: Message | null): Message {
  return {
    guid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatGuid,
    text,
    dateCreated: Date.now(),
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    sender: null,
    attachments: [],
    reactions: [],
    replyToGuid: replyTo?.guid ?? null,
    replyToPreview: replyTo ? replyTo.text.slice(0, 120) : null,
    replyToFromMe: replyTo?.isFromMe ?? null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    pending: true,
  };
}

export function Composer({
  chatGuid,
  replyTo,
  editing,
  onClearReply,
  onClearEditing,
  onEdited,
  onOptimistic,
  onSettled,
  onSent,
}: ComposerProps) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) setText(editing.text);
  }, [editing]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (editing) {
      setBusy(true);
      try {
        await api.edit(editing.guid, trimmed);
        onEdited({ ...editing, text: trimmed, edited: true });
        setText("");
        onClearEditing();
      } catch {
        // leave text for retry
      } finally {
        setBusy(false);
      }
      return;
    }

    const temp = tempMessage(chatGuid, trimmed, replyTo);
    const reply = replyTo;
    setText("");
    onClearReply();
    onOptimistic(temp);
    try {
      const message = await api.sendText(chatGuid, {
        text: trimmed,
        replyToGuid: reply?.guid,
      });
      onSettled(temp.guid, message);
    } catch {
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
    }
  };

  const attach = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.9,
    });
    const asset = result.assets?.[0];
    if (!asset) return;
    setBusy(true);
    try {
      const form = new FormData();
      const name = asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`;
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        form.append("attachment", new File([blob], name));
      } else {
        form.append("attachment", {
          uri: asset.uri,
          name,
          type: asset.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }
      const res = await fetch(
        `${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/attachment`,
        { method: "POST", body: form },
      );
      if (res.ok) onSent((await res.json()) as Message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { borderTopColor: theme.divider }]}>
      {replyTo && !editing && (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <Text numberOfLines={1} style={[styles.bannerText, { color: theme.textSecondary }]}>
            Replying to: {replyTo.text.slice(0, 80) || "attachment"}
          </Text>
          <Pressable onPress={onClearReply} hitSlop={8}>
            <Text style={{ color: theme.textSecondary }}>✕</Text>
          </Pressable>
        </View>
      )}
      {editing && (
        <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
          <Text numberOfLines={1} style={[styles.bannerText, { color: theme.text, fontWeight: "600" }]}>
            Editing message
          </Text>
          <Pressable
            onPress={() => {
              setText("");
              onClearEditing();
            }}
            hitSlop={8}
          >
            <Text style={{ color: theme.textSecondary }}>✕</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.inputRow}>
        <Pressable onPress={() => void attach()} disabled={busy} hitSlop={8} style={styles.attachButton}>
          <Text style={{ fontSize: 22, color: theme.textSecondary }}>＋</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={editing ? "Edit message" : "iMessage"}
          placeholderTextColor={theme.textSecondary}
          multiline
          enterKeyHint="send"
          submitBehavior="submit"
          onSubmitEditing={() => void send()}
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: theme.divider,
              backgroundColor: theme.background,
            },
          ]}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!text.trim() || busy}
          style={[
            styles.sendButton,
            { backgroundColor: text.trim() ? theme.bubbleMine : theme.backgroundElement },
          ]}
        >
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
    gap: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  attachButton: {
    paddingBottom: 7,
    paddingLeft: 2,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
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
