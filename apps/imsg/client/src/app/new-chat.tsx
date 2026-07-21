import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { NewChatContent } from "@/components/new-chat-content";

export default function NewChatScreen() {
  const { address, name } = useLocalSearchParams<{ address?: string; name?: string }>();
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
