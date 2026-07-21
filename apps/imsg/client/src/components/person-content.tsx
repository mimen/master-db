import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { avatarUrl } from "@/lib/api";
import { getChats, subscribeChats } from "@/lib/chat-store";
import { initials } from "@/lib/format";
import { useCreatePerson, useWhoIs } from "@/lib/identity";
import { selectChat } from "@/lib/selection";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

type NetworkIcon =
  | { family: "ionicons"; name: keyof typeof Ionicons.glyphMap }
  | { family: "fa5"; name: string };

const NETWORK_META: Record<string, { label: string; icon: NetworkIcon; color: string }> = {
  imessage: { label: "iMessage", icon: { family: "ionicons", name: "chatbubble-ellipses" }, color: "#0A84FF" },
  apple_contact: { label: "iMessage", icon: { family: "ionicons", name: "chatbubble-ellipses" }, color: "#0A84FF" },
  whatsapp: { label: "WhatsApp", icon: { family: "fa5", name: "whatsapp" }, color: "#25D366" },
  telegram: { label: "Telegram", icon: { family: "fa5", name: "telegram" }, color: "#229ED9" },
  slack: { label: "Slack", icon: { family: "fa5", name: "slack" }, color: "#4A154B" },
  gmessages: { label: "Google Messages", icon: { family: "ionicons", name: "logo-google" }, color: "#1A73E8" },
  signal: { label: "Signal", icon: { family: "ionicons", name: "chatbox-ellipses-outline" }, color: "#3A76F0" },
  matrix: { label: "Matrix", icon: { family: "ionicons", name: "git-network-outline" }, color: "#0DBD8B" },
  airtable_human: { label: "Airtable", icon: { family: "ionicons", name: "grid-outline" }, color: "#FCB400" },
  manual: { label: "Added manually", icon: { family: "ionicons", name: "person-add-outline" }, color: "#8E8E93" },
  other: { label: "Other", icon: { family: "ionicons", name: "chatbubbles-outline" }, color: "#8E8E93" },
};

function metaFor(network: string | undefined, source: string, kind: string) {
  return NETWORK_META[network ?? source] ?? NETWORK_META[kind] ?? NETWORK_META.other;
}

function NetworkIconView({ icon, color, size }: { icon: NetworkIcon; color: string; size: number }) {
  if (icon.family === "fa5") return <FontAwesome5 name={icon.name} size={size} color={color} />;
  return <Ionicons name={icon.name} size={size} color={color} />;
}

/** Best-effort match: a chat participant belongs to this person if a phone's last-10-digits or a lowercased email matches. */
function participantMatches(address: string, phones: string[], emails: string[]): boolean {
  const lower = address.toLowerCase();
  if (emails.includes(lower)) return true;
  const digits = address.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const suffix = digits.slice(-10);
  return phones.some((p) => p.replace(/\D/g, "").slice(-10) === suffix);
}

function useSharedChats(phones: string[], emails: string[]): ChatSummary[] {
  const [all, setAll] = useState<ChatSummary[]>(getChats() ?? []);
  useEffect(() => subscribeChats(setAll), []);
  if (phones.length === 0 && emails.length === 0) return [];
  return all.filter((c) => c.participants.some((p) => participantMatches(p.address, phones, emails)));
}

export interface PersonContentProps {
  address: string;
  name?: string;
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
}

/** Person-detail view, shared by the mobile /person modal and the desktop contacts pane. */
export function PersonContent({ address, name, showHeader = false, onClose }: PersonContentProps) {
  const theme = useTheme();
  const result = useWhoIs(address);
  const createPerson = useCreatePerson();
  const [creating, setCreating] = useState(false);

  const phones = result?.found ? result.person.normalized_phones : [];
  const emails = result?.found ? result.person.normalized_emails : [];
  const sharedChats = useSharedChats(phones, emails);
  const hasDirectThread = sharedChats.some((c) => !c.isGroup);

  const openChat = (chat: ChatSummary) => {
    if (!selectChat({ guid: chat.guid, name: chat.displayName, isGroup: chat.isGroup })) {
      router.push({
        pathname: "/chat/[guid]",
        params: { guid: chat.guid, name: chat.displayName, isGroup: chat.isGroup ? "1" : "0" },
      });
      return;
    }
    router.push("/");
  };

  const startMessage = () => {
    router.push({ pathname: "/new-chat", params: { address, name: name ?? "" } });
  };

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.paneHeaderTitle, { color: theme.text }]}>Contact</Text>
      {onClose && (
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close contact">
          <Ionicons name="close" size={22} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  ) : null;

  if (result === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  if (!result.found) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <View style={styles.container}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 20, fontWeight: "600" }}>
              {initials(name || address)}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{name || address}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 14, marginBottom: 24 }}>{address}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 14, marginBottom: 16 }}>
            No linked contact found.
          </Text>
          <Pressable
            disabled={creating}
            style={[styles.addButton, { backgroundColor: theme.backgroundElement }]}
            onPress={async () => {
              setCreating(true);
              try {
                await createPerson({ handle: address, display_name: name || undefined });
                showToast("Contact added");
              } catch {
                showToast("Failed to add contact");
              } finally {
                setCreating(false);
              }
            }}
          >
            {creating ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: "#0A84FF", fontSize: 16, fontWeight: "600" }}>+ Add Contact</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  const { person, identities } = result;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 20, fontWeight: "600" }}>
            {initials(person.display_name ?? address)}
          </Text>
          <Image source={{ uri: avatarUrl(address) }} style={styles.avatarImg} contentFit="cover" />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{person.display_name ?? address}</Text>
        <Text style={{ color: theme.textSecondary, fontSize: 14, marginBottom: 20 }}>{address}</Text>

        {!hasDirectThread && (
          <Pressable style={[styles.messageButton, { backgroundColor: theme.bubbleMine }]} onPress={startMessage}>
            <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Message</Text>
          </Pressable>
        )}

        {sharedChats.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              {sharedChats.length === 1 ? "Conversation" : `Conversations (${sharedChats.length})`}
            </Text>
            {sharedChats.map((c) => (
              <Pressable key={c.guid} style={styles.chatRow} onPress={() => openChat(c)}>
                <Ionicons
                  name={c.isGroup ? "people-circle-outline" : "chatbubble-ellipses-outline"}
                  size={20}
                  color={theme.textSecondary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.text, fontSize: 15 }} numberOfLines={1}>
                    {c.displayName}
                  </Text>
                  {c.lastMessage?.text ? (
                    <Text style={{ color: theme.textSecondary, fontSize: 13 }} numberOfLines={1}>
                      {c.lastMessage.text}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </Pressable>
            ))}
          </View>
        )}

        {identities.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Known on</Text>
            {identities.map((i) => {
              const meta = metaFor(i.network, i.source, i.kind);
              const isAirtable = i.source === "airtable_human" && Boolean(person.airtable_human_id);
              return (
                <Pressable
                  key={`${i.source}:${i.value}`}
                  style={styles.networkRow}
                  disabled={!isAirtable}
                  onPress={
                    isAirtable
                      ? () =>
                          Linking.openURL(
                            `https://airtable.com/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9/${person.airtable_human_id}`,
                          )
                      : undefined
                  }
                >
                  <NetworkIconView icon={meta.icon} color={meta.color} size={18} />
                  <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{meta.label}</Text>
                  <Text style={{ color: theme.textSecondary, fontSize: 13 }} numberOfLines={1}>
                    {isAirtable ? "View record" : i.value}
                  </Text>
                  {isAirtable && <Ionicons name="open-outline" size={14} color={theme.textSecondary} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderTitle: { fontSize: 16, fontWeight: "600" },
  container: { flex: 1, alignItems: "center", padding: 24, paddingTop: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
  },
  avatarImg: { position: "absolute", width: 80, height: 80, borderRadius: 40 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 4, textAlign: "center" },
  addButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  messageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginBottom: 8,
  },
  section: { width: "100%", marginTop: 16 },
  sectionLabel: { fontSize: 13, textTransform: "uppercase", marginBottom: 8 },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3A3A3C",
  },
  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3A3A3C",
  },
});
