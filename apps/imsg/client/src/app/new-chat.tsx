import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { NewChatContent } from "@/components/new-chat-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";

export default function NewChatScreen(): React.JSX.Element | null {
  const { address, name } = useLocalSearchParams<{ address?: string; name?: string }>();
  const { wide } = useLayoutMode();
  if (wide) return null;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <NewChatContent
        onClose={() => router.dismiss()}
        initialContact={address ? { address, name: name || address } : undefined}
      />
    </KeyboardAvoidingView>
  );
}
