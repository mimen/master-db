import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HugeiconsIcon } from "@hugeicons/react-native";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import * as Linking from "expo-linking";
import { fromBridgeMessage } from "@shared/imessage";
import type { ConversationId, Message } from "@shared/types";
import { faceTimeTargetUrl, type FaceTimeKind } from "@/lib/message-actions";
import { useActionSheet, type SheetAction } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import { useTheme } from "@/hooks/use-theme";
import { useConversation } from "@/hooks/use-chat-directory";
import { useRouteSupport } from "@/hooks/use-route-support";
import { gated } from "@/lib/route-support";

interface FaceTimeButtonProps {
  conversationId: ConversationId;
  isGroup: boolean;
  address: string | null;
  color: string;
  onSent?: (message: Message) => void;
  compact?: boolean;
}

/** The FaceTime actions the conversation's route offers; empty when none is live. */
export function useFaceTimeActions({ conversationId, isGroup, address, onSent }: Omit<FaceTimeButtonProps, "color" | "compact">): SheetAction[] {
  const can = useRouteSupport(useConversation(conversationId));

  const openDirect = async (kind: FaceTimeKind): Promise<void> => {
    if (!address) {
      showToast("No FaceTime address is available for this conversation");
      return;
    }
    try {
      await Linking.openURL(faceTimeTargetUrl(address, kind));
    } catch {
      showToast("FaceTime isn't available on this device");
    }
  };

  const createGroupLink = async (): Promise<void> => {
    try {
      const result = await runCommand(conversationId, { kind: "createFaceTimeLink" });
      onSent?.(fromBridgeMessage(result.message));
      showToast("FaceTime link sent");
    } catch (error) {
      showToast(messagingCommandError(error, "Couldn't create a FaceTime link"));
    }
  };

  const actions = isGroup
    ? gated(can("faceTimeLink"), { label: "Create & Send FaceTime Link", onPress: () => void createGroupLink() })
    : [
        ...gated(can("call"), { label: "FaceTime Audio", onPress: () => void openDirect("audio") }),
        ...gated(can("call"), { label: "FaceTime Video", onPress: () => void openDirect("video") }),
      ];
  // A route that cannot call at all (Slack) shows no FaceTime, not a greyed one.
  return actions.some((action) => !action.disabled) ? actions : [];
}

export function FaceTimeButton({ color, compact = false, ...props }: FaceTimeButtonProps): ReactElement | null {
  const showSheet = useActionSheet();
  const theme = useTheme();
  const actions = useFaceTimeActions(props);
  if (actions.length === 0) return null;

  const openActions = (): void => {
    showSheet({ title: "FaceTime", actions });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="FaceTime actions"
      onPress={openActions}
      hitSlop={8}
      style={({ hovered, pressed }) => [
        compact ? styles.compact : styles.chip,
        hovered && !pressed && { backgroundColor: theme.backgroundElement },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      {({ hovered, pressed }) => (
        <HugeiconsIcon icon={Video01Icon} size={compact ? 21 : 22} color={hovered || pressed ? theme.text : color} strokeWidth={1.8} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { alignItems: "center", borderRadius: 7, height: 28, justifyContent: "center", width: 32 },
  chip: { alignItems: "center", borderRadius: 7, height: 30, justifyContent: "center", width: 34 },
});
