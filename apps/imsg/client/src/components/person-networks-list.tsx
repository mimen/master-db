import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import type { IdentityRow } from "@/lib/identity";
import { airtableRecordUrl } from "@/lib/airtable";
import { useTheme } from "@/hooks/use-theme";

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

export interface PersonNetworksListProps {
  identities: IdentityRow[];
  airtableId: string | undefined;
}

/** The "Known on" section — one icon-boxed row per network identity, with the Airtable row deep-linking to its record. */
export function PersonNetworksList({ identities, airtableId }: PersonNetworksListProps) {
  const theme = useTheme();
  if (identities.length === 0) return null;

  return (
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
            onPress={isAirtable ? () => Linking.openURL(airtableRecordUrl(airtableId as string)) : undefined}
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
  );
}

const styles = StyleSheet.create({
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
});
