import type { ChatSummary } from "@shared/types";
import { Text } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { compactAge, isLateTurn } from "@/lib/turn-age";

/** A row's trailing age (14m, 2h, 3d), nested in the row's own time text so it inherits size. */
export function RowAge({ chat, now = Date.now() }: { chat: ChatSummary; now?: number }): React.JSX.Element | null {
  const theme = useTheme();
  if (!chat.lastMessage) return null;
  return (
    <Text style={[{ fontVariant: ["tabular-nums"] }, isLateTurn(chat, now) && { color: theme.turn, fontWeight: "600" }]}>
      {compactAge(now - chat.lastMessage.dateCreated)}
    </Text>
  );
}
