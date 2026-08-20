import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import type { Message } from "@shared/types";
import { api } from "@/lib/api";
import { faceTimeTargetUrl, type FaceTimeKind } from "@/lib/message-actions";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";

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
      <Ionicons name="videocam-outline" size={compact ? 18 : 22} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { alignItems: "center", borderRadius: 7, height: 28, justifyContent: "center", width: 32 },
});
