import { router, Stack, useLocalSearchParams } from "expo-router";
// SDK 54 pin: expo-router still rides react-navigation, so elements is importable.
import { useHeaderHeight } from "@react-navigation/elements";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { PersonAvatar, GroupPhotoAvatar } from "@/components/avatar";
import { ThreadView } from "@/components/thread-view";
import { FaceTimeButton } from "@/components/facetime-button";
import { openThreadSearch } from "@/lib/thread-search";
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
      {isGroup ? (
        <GroupPhotoAvatar guid={guid} size={32} iconSize={15} />
      ) : (
        <PersonAvatar address={dmAddress} name={name} size={32} />
      )}
      <View style={headerStyles.identityText}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
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
    justifyContent: "center",
    gap: 8,
    maxWidth: 220,
  },
  identityText: {
    flexShrink: 1,
  },
});

export default function ChatScreen(): React.JSX.Element | null {
  const params = useLocalSearchParams<{
    guid: string;
    name?: string;
    isGroup?: string;
    count?: string;
    targetGuid?: string;
    targetDate?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const isGroup = params.isGroup === "1" || params.guid.includes(";+;");
  const jumpTarget: JumpTarget | null =
    params.targetGuid && params.targetDate
      ? { guid: params.targetGuid, dateCreated: Number(params.targetDate) }
      : null;
  if (wide) return null;

  return (
    <>
      <Stack.Screen
        options={{
          headerTitleAlign: "center",
          headerTitle: () => (
            <HeaderTitle
              guid={params.guid}
              name={params.name ?? (params.guid.split(";").pop() ?? params.guid)}
              isGroup={isGroup}
              memberCount={params.count ? Number(params.count) : undefined}
            />
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 6 }}>
              <FaceTimeButton
                chatGuid={params.guid}
                isGroup={isGroup}
                address={isGroup ? null : (params.guid.split(";").pop() ?? null)}
                color={theme.accent}
              />
              <Pressable onPress={() => openThreadSearch()} hitSlop={8}>
                <Ionicons name="search" size={22} color={theme.accent} />
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: "/chat-info", params: { guid: params.guid } })}
                hitSlop={8}
              >
                <Ionicons name="information-circle-outline" size={26} color={theme.accent} />
              </Pressable>
            </View>
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
