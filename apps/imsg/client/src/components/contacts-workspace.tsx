import { router } from "expo-router";
import type { JSX, ReactNode } from "react";
import { View } from "react-native";

import { ContactsListPane } from "@/components/contacts-list-pane";
import { useDesktopShellContext } from "@/components/desktop-shell-context";
import { DesktopSplit } from "@/components/desktop-split";
import { EmptyState } from "@/components/empty-state";
import { PersonContent } from "@/components/person-content";
import { useTheme } from "@/hooks/use-theme";
import { primaryHandle } from "@/lib/identity";

export function ContactsWorkspace({
  wide,
  utilityPane = null,
}: {
  readonly wide: boolean;
  readonly utilityPane?: ReactNode;
}): JSX.Element {
  const theme = useTheme();
  const shell = useDesktopShellContext();
  const selection = shell.state.contacts.selection;

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
      list={
        <ContactsListPane
          wide
          selectedId={selection?.personId}
          hasSelection={selection !== null}
          onSelectPerson={(person) => {
            const address = primaryHandle(person);
            if (!address) return;
            shell.dispatch({
              type: "contacts/person-selected",
              selection: { address, name: person.display_name, personId: person._id },
            });
          }}
        />
      }
      detail={
        selection ? (
          <PersonContent
            key={selection.personId ?? selection.address}
            address={selection.address}
            name={selection.name}
          />
        ) : (
          <EmptyState icon="person-circle-outline" message="Select a contact" />
        )
      }
    >
      {utilityPane}
    </DesktopSplit>
  );
}
