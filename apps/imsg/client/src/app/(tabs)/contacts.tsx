import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { ContactsListPane } from "@/components/contacts-list-pane";
import { PersonContent } from "@/components/person-content";
import { useTheme } from "@/hooks/use-theme";
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

  return (
    <View style={[styles.split, { backgroundColor: theme.background }]}>
      <ContactsListPane wide selectedId={selectedPerson?._id} onSelectPerson={setSelectedPerson} />
      <View style={styles.detailPane}>
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
  split: { flex: 1, flexDirection: "row" },
  detailPane: { flex: 1 },
  empty: { alignItems: "center", flex: 1, gap: 9, justifyContent: "center" },
  emptyText: { fontSize: 15 },
});
