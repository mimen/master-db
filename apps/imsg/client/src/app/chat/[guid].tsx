import { Stack, useLocalSearchParams } from "expo-router";
// SDK 54 pin: expo-router still rides react-navigation, so elements is importable.
import { useHeaderHeight } from "@react-navigation/elements";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { avatarUrl, groupPhotoUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import { useTheme } from "@/hooks/use-theme";
import { ThreadView } from "@/components/thread-view";
import type { JumpTarget } from "@/hooks/use-messages";

function HeaderTitle({
  guid,
  name,
  isGroup,
  memberCount,
}: {
  guid: string;
  name: string;
  isGroup: boolean;
  memberCount?: number;
}) {
  const theme = useTheme();
  const dmAddress = !isGroup ? (guid.split(";").pop() ?? null) : null;
  return (
    <View style={headerStyles.container}>
      <View style={[headerStyles.avatar, { backgroundColor: theme.backgroundElement }]}>
        {isGroup ? (
          <Ionicons name="people" size={15} color={theme.textSecondary} />
        ) : (
          <Text style={{ fontSize: 10, fontWeight: "600", color: theme.textSecondary }}>
            {initials(name)}
          </Text>
        )}
        <Image
          source={{ uri: isGroup ? groupPhotoUrl(guid) : avatarUrl(dmAddress ?? "") }}
          style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
          contentFit="cover"
        />
      </View>
      <View style={{ minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}>
          {name}
        </Text>
        {isGroup && memberCount !== undefined && memberCount > 0 && (
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{memberCount} people</Text>
        )}
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: 260,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});

export default function ChatScreen() {
  const params = useLocalSearchParams<{
    guid: string;
    name?: string;
    isGroup?: string;
    count?: string;
    targetGuid?: string;
    targetDate?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const isGroup = params.isGroup === "1" || params.guid.includes(";+;");
  const jumpTarget: JumpTarget | null =
    params.targetGuid && params.targetDate
      ? { guid: params.targetGuid, dateCreated: Number(params.targetDate) }
      : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <HeaderTitle
              guid={params.guid}
              name={params.name ?? (params.guid.split(";").pop() ?? params.guid)}
              isGroup={isGroup}
              memberCount={params.count ? Number(params.count) : undefined}
            />
          ),
        }}
      />
      <ThreadView
        chatGuid={params.guid}
        isGroup={isGroup}
        jumpTarget={jumpTarget}
        headerOffset={headerHeight}
      />
    </>
  );
}
