import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { ThreadView } from "@/components/thread-view";
import type { JumpTarget } from "@/hooks/use-messages";

export default function ChatScreen() {
  const params = useLocalSearchParams<{
    guid: string;
    name?: string;
    isGroup?: string;
    targetGuid?: string;
    targetDate?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const jumpTarget: JumpTarget | null =
    params.targetGuid && params.targetDate
      ? { guid: params.targetGuid, dateCreated: Number(params.targetDate) }
      : null;

  return (
    <>
      <Stack.Screen options={{ title: params.name ?? params.guid }} />
      <ThreadView
        chatGuid={params.guid}
        isGroup={params.isGroup === "1" || params.guid.includes(";+;")}
        jumpTarget={jumpTarget}
        headerOffset={headerHeight}
      />
    </>
  );
}
