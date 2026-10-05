import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import UserMultipleIcon from "@hugeicons/core-free-icons/UserMultipleIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { IconButton } from "@/components/ui/icon-button";
import { useTheme } from "@/hooks/use-theme";
import { commaApi } from "@/lib/convex-api";
import { openScheduledPane } from "@/lib/scheduled-pane";
import { pendingScheduledCount } from "@/lib/scheduled";
import { openSettingsPane } from "@/lib/settings-pane";

function FooterButton({ icon, label, on, onPress }: { icon: IconSvgElement; label: string; on?: boolean; onPress: () => void }): React.JSX.Element {
  const theme = useTheme();
  return (
    <IconButton label={label} onPress={onPress} style={[styles.button, on && { backgroundColor: theme.rowSelected }]}>
      {({ active }) => <HugeiconsIcon icon={icon} size={18} color={on || active ? theme.text : theme.icon} strokeWidth={1.6} />}
    </IconButton>
  );
}

/**
 * The wide sidebar's footer: Contacts, Scheduled with its pending count, and
 * Settings. It is the desktop's workspace navigation; Contacts toggles back
 * to Messages when it is already open.
 */
export function SidebarFooter({ workspace }: { readonly workspace: "messages" | "contacts" }): React.JSX.Element {
  const theme = useTheme();
  const pending = pendingScheduledCount(useQuery(commaApi.listScheduled, {}));
  const onContacts = workspace === "contacts";
  return (
    <View role="navigation" aria-label="Workspaces" style={[styles.footer, { borderTopColor: theme.divider }]}>
      <FooterButton
        icon={UserMultipleIcon}
        label={onContacts ? "Messages" : "Contacts"}
        on={onContacts}
        onPress={() => router.replace(onContacts ? "/" : "/contacts")}
      />
      <FooterButton
        icon={Clock01Icon}
        label={pending > 0 ? `Scheduled, ${pending} pending` : "Scheduled"}
        onPress={() => {
          if (openScheduledPane()) return;
          router.push({ pathname: "/scheduled", params: { workspace } });
        }}
      />
      {pending > 0 ? <Text style={[styles.count, { color: theme.textTertiary }]}>{pending}</Text> : null}
      <View style={styles.spacer} />
      <FooterButton
        icon={Settings02Icon}
        label="Settings"
        onPress={() => {
          if (openSettingsPane()) return;
          router.push({ pathname: "/settings", params: { workspace } });
        }}
      />
    </View>
  );
}

export const SIDEBAR_FOOTER_HEIGHT = 46;

const styles = StyleSheet.create({
  footer: { alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 2, height: SIDEBAR_FOOTER_HEIGHT, paddingHorizontal: 10 },
  button: { borderRadius: 7, height: 30, width: 30 },
  count: { fontSize: 11.5, fontVariant: ["tabular-nums"], marginLeft: -2, marginRight: 6 },
  spacer: { flex: 1 },
});
