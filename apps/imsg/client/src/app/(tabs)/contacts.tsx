import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { ContactsListPane } from "@/components/contacts-list-pane";
import { EmptyState } from "@/components/empty-state";
import { PersonContent } from "@/components/person-content";
import { ScheduledContent } from "@/components/scheduled-content";
import { SettingsContent } from "@/components/settings-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { DesktopAuxPane, DesktopSplit } from "@/components/desktop-split";
import { primaryHandle, type ContactListRow } from "@/lib/identity";
import { onOpenScheduledPane } from "@/lib/scheduled-pane";
import { onOpenSettingsPane } from "@/lib/settings-pane";

export default function ContactsScreen() {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const [selectedPerson, setSelectedPerson] = useState<ContactListRow | null>(null);
  const [auxPane, setAuxPane] = useState<"scheduled" | "settings" | null>(null);

  useEffect(() => {
    if (!wide) return;
    return onOpenScheduledPane(() => setAuxPane("scheduled"));
  }, [wide]);
  useEffect(() => {
    if (!wide) return;
    return onOpenSettingsPane(() => setAuxPane("settings"));
  }, [wide]);

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
    <DesktopSplit
      listInset={64}
      list={<ContactsListPane wide selectedId={selectedPerson?._id} onSelectPerson={setSelectedPerson} />}
      detail={
        selectedPerson ? (
          <PersonContent
            key={selectedPerson._id}
            address={primaryHandle(selectedPerson) ?? ""}
            name={selectedPerson.display_name}
          />
        ) : (
          <EmptyState icon="person-circle-outline" message="Select a contact" />
        )
      }
    >
      <DesktopAuxPane open={auxPane !== null}>
        {auxPane === "scheduled" ? (
          <ScheduledContent showHeader onClose={() => setAuxPane(null)} />
        ) : auxPane === "settings" ? (
          <SettingsContent showHeader onClose={() => setAuxPane(null)} />
        ) : null}
      </DesktopAuxPane>
    </DesktopSplit>
  );
}
