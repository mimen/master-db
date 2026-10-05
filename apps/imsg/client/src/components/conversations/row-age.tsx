import type { ChatSummary } from "@shared/types";
import { Text } from "react-native";

import { formatAge } from "@/lib/format";
import { isLateTurn } from "@/lib/row-signal";

import { useSignal } from "./signal";

/** A row's trailing age (14m, 2h, 3d), nested in the row's own time text so it inherits size. */
export function RowAge({ chat }: { chat: ChatSummary }): React.JSX.Element | null {
  const signal = useSignal();
  if (!chat.lastMessage) return null;
  return (
    <Text style={[{ fontVariant: ["tabular-nums"] }, isLateTurn(chat) && { color: signal.turn, fontWeight: "600" }]}>
      {formatAge(chat.lastMessage.dateCreated)}
    </Text>
  );
}
