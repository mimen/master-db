import { router } from "expo-router";
import { useCallback, useState, type JSX } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ContactAddPanel } from "@/components/contacts-add-panel";
import { ContactsListPane } from "@/components/contacts-list-pane";
import { ContactsMerge } from "@/components/contacts-merge";
import { useTheme } from "@/hooks/use-theme";
import { ContactsTopBar } from "@/components/contacts-ui";
import { useDesktopShellContext } from "@/components/desktop-shell-context";
import { DesktopSplit } from "@/components/desktop-split";
import { PersonContent } from "@/components/person-content";
import { type ContactListRow, primaryHandle } from "@/lib/identity";

type Mode = "person" | "merge" | "add";

export function ContactsWorkspace({ wide }: { readonly wide: boolean }): JSX.Element {
  const colors = useTheme();
  const shell = useDesktopShellContext();
  const selection = shell.state.contacts.selection;
  const [mode, setMode] = useState<Mode>("person");

  const select = useCallback((person: ContactListRow) => {
    const address = primaryHandle(person);
    if (!address) return;
    setMode("person");
    if (!wide) {
      router.push({ pathname: "/person", params: { address, name: person.display_name } });
      return;
    }
    shell.dispatch({
      type: "contacts/person-selected",
      selection: { address, name: person.display_name, personId: person._id },
    });
  }, [shell, wide]);

  const exitMode = useCallback(() => setMode("person"), []);
  const list = (
    <ContactsListPane
      wide={wide}
      selectedId={mode === "person" ? selection?.personId : undefined}
      hasSelection={selection !== null}
      onSelectPerson={select}
      onReviewDuplicates={() => setMode("merge")}
      onAddContact={() => setMode("add")}
    />
  );

  const addPane = (
    <View style={[styles.fill, { backgroundColor: colors.thread }]}>
      {wide ? <ContactsTopBar title="New contact" onCrumb={exitMode} /> : null}
      <ScrollView contentContainerStyle={styles.addWrap}>
        <ContactAddPanel
          title="New contact"
          onClose={exitMode}
          onDone={(personId, handle) => {
            setMode("person");
            if (personId && handle && wide) {
              shell.dispatch({ type: "contacts/person-selected", selection: { address: handle, personId } });
            }
          }}
        />
      </ScrollView>
    </View>
  );

  if (!wide) {
    if (mode === "merge") return <ContactsMerge wide={false} onExit={exitMode} onMerged={exitMode} />;
    if (mode === "add") return addPane;
    return <View style={[styles.fill, { backgroundColor: colors.background }]}>{list}</View>;
  }

  const detail = mode === "merge" ? (
    <ContactsMerge wide onExit={exitMode} onMerged={(kept) => select(kept)} />
  ) : mode === "add" ? addPane : selection ? (
    <PersonContent key={selection.personId ?? selection.address} address={selection.address} name={selection.name} />
  ) : (
    <View style={[styles.fill, styles.empty, { backgroundColor: colors.thread }]}>
      <Text style={{ color: colors.textTertiary, fontSize: 13 }}>Select a contact</Text>
    </View>
  );

  return <DesktopSplit list={list} detail={detail} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  empty: { alignItems: "center", justifyContent: "center" },
  addWrap: { alignItems: "center", padding: 32 },
});
