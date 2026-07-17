import { router } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { SearchContent } from "@/components/search-content";

export default function SearchScreen() {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SearchContent onClose={() => router.dismiss()} />
    </KeyboardAvoidingView>
  );
}
