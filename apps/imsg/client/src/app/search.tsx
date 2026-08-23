import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { SearchContent } from "@/components/search-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";

export default function SearchScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  const params = useLocalSearchParams<{ query?: string | string[]; chat?: string; name?: string }>();
  const queryParam = params.query;
  const initialQuery = Array.isArray(queryParam) ? (queryParam[0] ?? "") : queryParam;
  const chat = Array.isArray(params.chat) ? params.chat[0] : params.chat;
  const name = Array.isArray(params.name) ? params.name[0] : params.name;
  if (wide) return null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SearchContent initialQuery={initialQuery} scopeChatGuid={chat} scopeLabel={name} onClose={() => router.dismiss()} />
    </KeyboardAvoidingView>
  );
}
