import { router, useLocalSearchParams } from "expo-router";
import { ChatInfoContent } from "@/components/chat-info-content";

export default function ChatInfoScreen() {
  const { guid } = useLocalSearchParams<{ guid: string }>();
  return (
    <ChatInfoContent
      guid={guid ?? ""}
      onClose={() => router.back()}
      onDeleted={() => {
        router.dismissAll?.();
        router.replace("/");
      }}
    />
  );
}
