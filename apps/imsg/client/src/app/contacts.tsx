import { router } from "expo-router";
import { ContactsListPane } from "@/components/contacts-list-pane";
import { primaryHandle } from "@/lib/identity";

export default function ContactsScreen() {
  return (
    <ContactsListPane
      wide={false}
      onSelectPerson={(p) => {
        const address = primaryHandle(p);
        if (!address) return;
        router.push({ pathname: "/person", params: { address, name: p.display_name } });
      }}
    />
  );
}
