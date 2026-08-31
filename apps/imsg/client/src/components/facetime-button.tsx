import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { Video01Icon } from "@hugeicons/core-free-icons";
import * as Linking from "expo-linking";
import type { Message } from "@shared/types";
import { api } from "@/lib/api";
import { faceTimeTargetUrl, type FaceTimeKind } from "@/lib/message-actions";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import { useTheme } from "@/hooks/use-theme";

interface FaceTimeButtonProps {
  chatGuid: string;
  isGroup: boolean;
  address: string | null;
  color: string;
  onSent?: (message: Message) => void;
  compact?: boolean;
}

export function FaceTimeButton({
  chatGuid,
  isGroup,
  address,
  color,
  onSent,
  compact = false,
}: FaceTimeButtonProps): ReactElement {
  const showSheet = useActionSheet();
  const theme = useTheme();

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
      const result = await api.createFaceTimeLink(chatGuid);
      onSent?.(result.message);
      showToast("FaceTime link sent");
    } catch {
      showToast("Couldn't create a FaceTime link");
    }
  };

  const openActions = (): void => {
    showSheet({
      title: "FaceTime",
      actions: isGroup
        ? [{ label: "Create & Send FaceTime Link", onPress: () => void createGroupLink() }]
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
      style={compact ? styles.compact : undefined}
    >
      {({ hovered, pressed }) => (
        <HugeiconsIcon icon={Video01Icon} size={compact ? 21 : 22} color={hovered || pressed ? theme.text : color} strokeWidth={1.8} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { alignItems: "center", borderRadius: 7, height: 28, justifyContent: "center", width: 32 },
});
