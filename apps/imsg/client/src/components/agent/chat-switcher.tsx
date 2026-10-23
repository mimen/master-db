import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentAttention } from "@shared/agent-attention";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { Dropdown, type DropdownOption } from "@/components/ui/dropdown";
import { Radius } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import type { AgentChatSummary } from "@/lib/agent-api";
import { switcherRows, type PaneSelection, type SwitcherValue } from "@/lib/agent-chats";

type Theme = ReturnType<typeof useTheme>;

/** Shape carries the state as well as color: a dotted ring while working, a plain ring when open. */
function dotStyle(attention: AgentAttention, theme: Theme): ViewStyle {
  switch (attention) {
    case "needs_you": return { backgroundColor: theme.turnMark };
    case "failed": return { backgroundColor: theme.destructive };
    case "ready": return { backgroundColor: theme.accent };
    case "working": return { borderWidth: 1.5, borderColor: theme.icon, borderStyle: "dotted" };
    case "open": return { borderWidth: 1.5, borderColor: theme.textTertiary };
    case "settled": return { backgroundColor: theme.disabled };
  }
}

/** The agent pane's title: this conversation's chats, open then settled, and New chat. */
export function ChatSwitcher({ chats, name, selection, onSelect }: {
  readonly chats: readonly AgentChatSummary[];
  readonly name: string;
  readonly selection: PaneSelection;
  readonly onSelect: (next: PaneSelection) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const options: DropdownOption<SwitcherValue>[] = switcherRows(chats, name, selection, Date.now()).map((row) => ({
    value: row.value,
    label: row.label,
    trailing: row.trailing,
    section: row.section,
    icon: row.attention
      ? <View style={[styles.dot, dotStyle(row.attention, theme)]} />
      : <Ionicons name="add" size={12} color={theme.icon} style={styles.plus} />,
  }));
  return (
    <Dropdown
      variant="title"
      label="Agent chat"
      value={selection.kind === "chat" ? selection.chatId : "new"}
      options={options}
      menuWidth={300}
      onChange={(value) => onSelect(value === "new" ? { kind: "new" } : { kind: "chat", chatId: value })}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: Radius.full },
  plus: { width: 8, textAlign: "center" },
});
