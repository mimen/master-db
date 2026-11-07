import { useQuery } from "convex/react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { commaApi } from "@/lib/convex-api";
import { identityApi } from "@/lib/identity-api";
import { conversationRoute } from "@/lib/selection";

/**
 * Links from before conversations had their own URL: bookmarks, notifications, agent links, and
 * deep links that name a chat GUID or a handle. Each resolves once to its conversation's /c/<id>.
 */
export default function LegacyChatRedirect(): React.JSX.Element | null {
  const params = useLocalSearchParams<{ guid: string; targetGuid?: string; targetDate?: string }>();
  const theme = useTheme();
  const isChatGuid = params.guid.includes(";");
  const byGuid = useQuery(commaApi.resolveChat, isChatGuid ? { chatGuid: params.guid } : "skip");
  const byHandle = useQuery(identityApi.findChat, isChatGuid ? "skip" : { address: params.guid });
  const conversationId = isChatGuid ? byGuid?._id : byHandle?.conversationId;
  if (conversationId) {
    const jumpTarget = params.targetGuid && params.targetDate ? { guid: params.targetGuid, dateCreated: Number(params.targetDate) } : null;
    return <Redirect href={conversationRoute(conversationId, jumpTarget)} />;
  }
  if ((isChatGuid ? byGuid : byHandle) !== null) return null;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
      <Text style={{ color: theme.textSecondary }}>Conversation not found</Text>
    </View>
  );
}
