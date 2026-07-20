import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { SearchContent } from "@/components/search-content";

export default function SearchScreen() {
  const { query: queryParam } = useLocalSearchParams<{ query?: string | string[] }>();
  const initialQuery = Array.isArray(queryParam) ? (queryParam[0] ?? "") : queryParam;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SearchContent initialQuery={initialQuery} onClose={() => router.dismiss()} />
    </KeyboardAvoidingView>
  );
}
