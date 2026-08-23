import type { JSX } from "react";

import { ContactsWorkspace } from "@/components/contacts-workspace";
import { useLayoutMode } from "@/hooks/use-layout-mode";

/**
 * Compact route adapter. On wide layouts the persistent root desktop shell
 * owns Contacts while this Stack route stays mounted but intentionally inert.
 */
export default function ContactsScreen(): JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return <ContactsWorkspace wide={false} />;
}
