import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ContactsListPane } from "@/components/contacts-list-pane";
import { EmptyState } from "@/components/empty-state";
import { PersonContent } from "@/components/person-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { desktopFrame } from "@/lib/desktop-frame";
import { primaryHandle, type ContactListRow } from "@/lib/identity";

export default function ContactsScreen() {
  const theme = useTheme();
  const { wide } = useLayoutMode();
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

  // Same flush split as Messages.
  const frame = desktopFrame(theme);

  return (
    <View style={frame.split}>
      <View style={[frame.pane, frame.listPane]}>
        <ContactsListPane wide selectedId={selectedPerson?._id} onSelectPerson={setSelectedPerson} />
      </View>
      <View style={[frame.pane, frame.detailPane]}>
        {selectedPerson ? (
          <PersonContent
            key={selectedPerson._id}
            address={primaryHandle(selectedPerson) ?? ""}
            name={selectedPerson.display_name}
          />
        ) : (
          <EmptyState icon="person-circle-outline" message="Select a contact" />
        )}
      </View>
    </View>
  );
}
