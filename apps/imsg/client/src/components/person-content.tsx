import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { avatarUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import { useCreatePerson, useWhoIs } from "@/lib/identity";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";

const NETWORK_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  gmessages: "Google Messages",
  imessage: "iMessage",
  telegram: "Telegram",
  slack: "Slack",
  signal: "Signal",
  matrix: "Matrix",
  apple_contact: "Apple Contacts",
  manual: "Added manually",
};

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
        <Text style={{ color: theme.textSecondary, fontSize: 14, marginBottom: 24 }}>{address}</Text>

        {identities.length > 1 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Known on {identities.length} networks
            </Text>
            {identities.map((i) => (
              <View key={`${i.source}:${i.value}`} style={styles.networkRow}>
                <Text style={{ color: theme.text, fontSize: 15 }}>
                  {NETWORK_LABELS[i.network ?? ""] ?? NETWORK_LABELS[i.source] ?? i.network ?? i.kind}
                </Text>
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{i.value}</Text>
              </View>
            ))}
          </View>
        )}

        {person.airtable_human_id && (
          <Pressable
            style={styles.linkOutRow}
            onPress={() =>
              Linking.openURL(
                `https://airtable.com/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9/${person.airtable_human_id}`,
              )
            }
          >
            <Ionicons name="open-outline" size={16} color="#0A84FF" />
            <Text style={{ color: "#0A84FF", fontSize: 15 }}>View in Airtable</Text>
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
  section: { width: "100%", marginTop: 8 },
  sectionLabel: { fontSize: 13, textTransform: "uppercase", marginBottom: 8 },
  networkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3A3A3C",
  },
  linkOutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
  },
});
