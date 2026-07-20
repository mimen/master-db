import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
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

export default function PersonScreen() {
  const theme = useTheme();
  const { address, name } = useLocalSearchParams<{ address: string; name?: string }>();
  const result = useWhoIs(address ?? null);
  const createPerson = useCreatePerson();
  const [creating, setCreating] = useState(false);

  if (!address || result === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!result.found) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 20, fontWeight: "600" }}>
            {initials(name || address)}
          </Text>
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{name || address}</Text>
        <Text style={{ color: theme.textSecondary, fontSize: 14, marginBottom: 24 }}>
          {address}
        </Text>
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
    );
  }

  const { person, identities } = result;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={styles.container}
    >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
