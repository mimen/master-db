import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { avatarUrl } from "@/lib/api";
import { getChats, subscribeChats } from "@/lib/chat-store";
import { formatListTimestamp, initials } from "@/lib/format";
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
  const directChat = sharedChats.find((c) => !c.isGroup);

  const sortedChats = useMemo(
    () => [...sharedChats].sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0)),
    [sharedChats],
  );
  const lastContactedAt = sortedChats[0]?.lastMessage?.dateCreated;
  const canCall = phones.length > 0;

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

  const handleMessage = () => {
    if (directChat) {
      openChat(directChat);
      return;
    }
    router.push({ pathname: "/new-chat", params: { address, name: name ?? "" } });
  };

  const handleCall = () => {
    if (phones[0]) Linking.openURL(`tel:${phones[0]}`);
  };

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.paneHeaderTitle, { color: theme.textSecondary }]}>Profile</Text>
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
            <Text style={{ color: theme.textSecondary, fontSize: 22, fontWeight: "600" }}>
              {initials(name || address)}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{name || address}</Text>
          <Text style={[styles.statusLine, { color: theme.textSecondary }]}>{address}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 14, marginTop: 16, marginBottom: 16 }}>
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
  const airtableId = person.airtable_human_id;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 22, fontWeight: "600" }}>
            {initials(person.display_name ?? address)}
          </Text>
          <Image source={{ uri: avatarUrl(address) }} style={styles.avatarImg} contentFit="cover" />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{person.display_name ?? address}</Text>
        <Text style={[styles.statusLine, { color: theme.textSecondary }]}>
          {lastContactedAt ? `Last contacted ${formatListTimestamp(lastContactedAt)}` : "No conversation yet"}
        </Text>

        <View style={styles.actionRow}>
          <Pressable style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]} onPress={handleMessage}>
            <Ionicons name="chatbubble-ellipses" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>Message</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.backgroundElement, opacity: canCall ? 1 : 0.4 }]}
            disabled={!canCall}
            onPress={handleCall}
          >
            <Ionicons name="call" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>Call</Text>
          </Pressable>
        </View>

        {identities.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Known on</Text>
            {identities.map((i) => {
              const meta = metaFor(i.network, i.source, i.kind);
              const isAirtable = i.source === "airtable_human" && Boolean(airtableId);
              return (
                <Pressable
                  key={`${i.source}:${i.value}`}
                  style={styles.infoRow}
                  disabled={!isAirtable}
                  onPress={
                    isAirtable
                      ? () =>
                          Linking.openURL(`https://airtable.com/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9/${airtableId}`)
                      : undefined
                  }
                >
                  <View style={[styles.infoIconBox, { backgroundColor: theme.backgroundElement }]}>
                    <NetworkIconView icon={meta.icon} color={meta.color} size={17} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{meta.label}</Text>
                    <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
                      {isAirtable ? "View record" : i.value}
                    </Text>
                  </View>
                  {isAirtable && <Ionicons name="open-outline" size={14} color={theme.textSecondary} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {sortedChats.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              {sortedChats.length === 1 ? "Conversation" : `${sortedChats.length} conversations`}
            </Text>
            {sortedChats.map((c) => (
              <Pressable key={c.guid} style={styles.chatRow} onPress={() => openChat(c)}>
                <Ionicons
                  name={c.isGroup ? "people-circle-outline" : "chatbubble-ellipses-outline"}
                  size={20}
                  color={theme.textSecondary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
                    {c.displayName}
                  </Text>
                  {c.lastMessage?.text ? (
                    <Text style={{ color: theme.textSecondary, fontSize: 13 }} numberOfLines={1}>
                      {c.lastMessage.text}
                    </Text>
                  ) : null}
                </View>
                {c.lastMessage?.dateCreated && (
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                    {formatListTimestamp(c.lastMessage.dateCreated)}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {airtableId && (
          <Pressable
            style={styles.footerLink}
            onPress={() => Linking.openURL(`https://airtable.com/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9/${airtableId}`)}
          >
            <Text style={{ color: "#0A84FF", fontSize: 14, fontWeight: "600" }}>View in Airtable</Text>
          </Pressable>
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
  paneHeaderTitle: { fontSize: 13, fontWeight: "600", textTransform: "uppercase" },
  container: { flex: 1, alignItems: "center", padding: 24, paddingTop: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    overflow: "hidden",
  },
  avatarImg: { position: "absolute", width: 96, height: 96, borderRadius: 48 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  statusLine: { fontSize: 14, textAlign: "center", marginBottom: 4 },
  addButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    width: "100%",
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  section: { width: "100%", marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  infoIconBox: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3A3A3C",
  },
  footerLink: {
    marginTop: 20,
    paddingVertical: 8,
  },
});
