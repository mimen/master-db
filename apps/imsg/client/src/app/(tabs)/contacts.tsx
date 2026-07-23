import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { ContactsListPane } from "@/components/contacts-list-pane";
import { PersonContent } from "@/components/person-content";
import { useTheme } from "@/hooks/use-theme";
import { CardShadow, Radii } from "@/constants/theme";
import { primaryHandle, type ContactListRow } from "@/lib/identity";

export default function ContactsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [selectedPerson, setSelectedPerson] = useState<ContactListRow | null>(null);

  if (!wide) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <ContactsListPane
          wide={false}
          onSelectPerson={(p) => {
            const address = primaryHandle(p);
            if (!address) return;
            router.push({ pathname: "/person", params: { address, name: p.display_name } });
          }}
        />
      </View>
    );
  }

  // Same desk + floating-card layout as the Messages split — Contacts is just
  // a toggled mode of the same shell, with the person view in the second pane.
  const cardStyle = [styles.card, { backgroundColor: theme.background, borderColor: theme.cardBorder }];

  return (
    <View style={[styles.split, { backgroundColor: theme.desk }]}>
      <View style={[styles.listCard, ...cardStyle]}>
        <ContactsListPane wide selectedId={selectedPerson?._id} onSelectPerson={setSelectedPerson} />
      </View>
      <View style={[styles.detailCard, ...cardStyle]}>
        {selectedPerson ? (
          <PersonContent
            key={selectedPerson._id}
            address={primaryHandle(selectedPerson) ?? ""}
            name={selectedPerson.display_name}
          />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="person-circle-outline" size={28} color={theme.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Select a contact</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  card: {
    borderRadius: Radii.card,
    // Top-lit edge highlight, not a theme color — see app/(tabs)/index.tsx.
    borderTopColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    ...CardShadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
  },
  listCard: {
    flexBasis: 380,
    flexGrow: 0,
    flexShrink: 0,
    width: 380,
  },
  detailCard: {
    flex: 1,
  },
  empty: { alignItems: "center", flex: 1, gap: 9, justifyContent: "center" },
  emptyText: { fontSize: 15 },
});
