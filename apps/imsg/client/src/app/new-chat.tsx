import { router } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { NewChatContent } from "@/components/new-chat-content";

export default function NewChatScreen() {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <NewChatContent onClose={() => router.dismiss()} />
    </KeyboardAvoidingView>
  );
}
