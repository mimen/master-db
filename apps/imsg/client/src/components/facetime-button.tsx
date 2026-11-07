import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HugeiconsIcon } from "@hugeicons/react-native";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import * as Linking from "expo-linking";
import type { ConversationId, Message } from "@shared/types";
import { faceTimeTargetUrl, type FaceTimeKind } from "@/lib/message-actions";
import { useActionSheet } from "@/lib/action-sheet";
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

export function FaceTimeButton({
  conversationId,
  isGroup,
  address,
  color,
  onSent,
  compact = false,
}: FaceTimeButtonProps): ReactElement {
  const showSheet = useActionSheet();
  const theme = useTheme();
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
      onSent?.(result.message);
      showToast("FaceTime link sent");
    } catch (error) {
      showToast(messagingCommandError(error, "Couldn't create a FaceTime link"));
    }
  };

  const openActions = (): void => {
    showSheet({
      title: "FaceTime",
      actions: isGroup
        ? gated(can("faceTimeLink"), { label: "Create & Send FaceTime Link", onPress: () => void createGroupLink() })
        : [
            { label: "FaceTime Audio", onPress: () => void openDirect("audio") },
            { label: "FaceTime Video", onPress: () => void openDirect("video") },
          ],
    });
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
