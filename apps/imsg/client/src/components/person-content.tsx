import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { avatarUrl } from "@/lib/api";
import { formatListTimestamp, initials } from "@/lib/format";
import { useCreatePerson } from "@/lib/identity";
import { airtableRecordUrl } from "@/lib/airtable";
import { usePersonView } from "@/hooks/use-person-view";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import { PersonConversationsList } from "./person-conversations-list";
import { PersonNetworksList } from "./person-networks-list";

export interface PersonContentProps {
  address: string;
  name?: string;
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
}

/**
 * Person-detail view, shared by the mobile /person modal and the desktop
 * contacts pane. Thin composition layer — data + matching lives in
 * usePersonView, the two list sections are their own components; this file
 * is just the header/avatar/actions chrome plus wiring.
 */
export function PersonContent({ address, name, showHeader = false, onClose }: PersonContentProps) {
  const theme = useTheme();
  const { result, sortedChats, lastContactedAt, canCall, handleMessage, handleCall, openChat } = usePersonView(
    address,
    name,
  );
  const createPerson = useCreatePerson();
  const [creating, setCreating] = useState(false);

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

        <PersonNetworksList identities={identities} airtableId={airtableId} />
        <PersonConversationsList chats={sortedChats} onOpenChat={openChat} />

        {airtableId && (
          <Pressable style={styles.footerLink} onPress={() => Linking.openURL(airtableRecordUrl(airtableId))}>
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
  footerLink: {
    marginTop: 20,
    paddingVertical: 8,
  },
});
