import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { SearchContent } from "@/components/lazy-surfaces";
import type { ConversationId } from "@shared/types";

export default function SearchScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  const params = useLocalSearchParams<{ query?: string | string[]; conversation?: ConversationId; name?: string }>();
  const queryParam = params.query;
  const initialQuery = Array.isArray(queryParam) ? (queryParam[0] ?? "") : queryParam;
  const conversation = Array.isArray(params.conversation) ? params.conversation[0] : params.conversation;
  const name = Array.isArray(params.name) ? params.name[0] : params.name;
  if (wide) return null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SearchContent initialQuery={initialQuery} scopeConversation={conversation} scopeLabel={name} onClose={() => router.dismiss()} />
    </KeyboardAvoidingView>
  );
}
