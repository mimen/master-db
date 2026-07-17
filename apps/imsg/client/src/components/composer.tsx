import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { showToast } from "@/lib/toast";
import { playSend } from "@/lib/sounds";
import { useActionSheet } from "@/lib/action-sheet";
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
  const showSheet = useActionSheet();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const typingActive = useRef(false);
  const typingIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) setText(editing.text);
  }, [editing]);

  // Desktop web: autofocus on chat open, and typing anywhere focuses the composer.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || window.innerWidth < 768) return;
    inputRef.current?.focus();
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const inField =
        active instanceof HTMLElement &&
        (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable);
      if (inField) return;
      if (event.key.length === 1) {
        inputRef.current?.focus();
        setText((t) => t + event.key);
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onGlobalKeyDown);
    return () => document.removeEventListener("keydown", onGlobalKeyDown);
  }, [chatGuid]);

  // Desktop web: Enter sends, Shift+Enter newlines (RN multiline swallows submit on web).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendRef.current();
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, []);

  const setTyping = (active: boolean) => {
    if (typingActive.current === active) return;
    typingActive.current = active;
    void fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    }).catch(() => undefined);
  };

  const onChangeText = (value: string) => {
    setText(value);
    if (!editing) {
      setTyping(value.length > 0);
      if (typingIdle.current) clearTimeout(typingIdle.current);
      typingIdle.current = setTimeout(() => setTyping(false), 5000);
    }
  };

  const sendRef = useRef<() => void>(() => undefined);
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
        showToast("Edit failed — edits are only allowed for ~15 minutes");
      } finally {
        setBusy(false);
      }
      return;
    }

    setTyping(false);
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
      playSend();
      onSettled(temp.guid, message);
    } catch {
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
    }
  };

  sendRef.current = () => void send();

  const uploadAsset = async (uri: string, name: string, mimeType: string) => {
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("attachment", new File([blob], name));
    } else {
      form.append("attachment", { uri, name, type: mimeType } as unknown as Blob);
    }
    const res = await fetch(`${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/attachment`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(String(res.status));
    onSent((await res.json()) as Message);
  };

  const pickPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.9,
    });
    if (!result.assets?.length) return;
    setBusy(true);
    try {
      for (const asset of result.assets) {
        await uploadAsset(
          asset.uri,
          asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`,
          asset.mimeType ?? "image/jpeg",
        );
      }
    } catch {
      showToast("Attachment failed");
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true });
    if (result.canceled || !result.assets?.length) return;
    setBusy(true);
    try {
      for (const asset of result.assets) {
        await uploadAsset(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream");
      }
    } catch {
      showToast("Attachment failed");
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
        <Pressable
          onPress={() =>
            showSheet({
              actions: [
                { label: "Photo or Video", onPress: () => void pickPhotos() },
                { label: "File", onPress: () => void pickFiles() },
              ],
            })
          }
          disabled={busy}
          hitSlop={8}
          style={styles.attachButton}
        >
          <Ionicons name="add-circle-outline" size={26} color={theme.textSecondary} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={onChangeText}
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
          <Ionicons name="arrow-up" size={20} color="#fff" />
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
