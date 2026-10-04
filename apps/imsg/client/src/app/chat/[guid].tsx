import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatAddress } from "@shared/address";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { PersonAvatar, GroupPhotoAvatar } from "@/components/avatar";
import { ThreadView } from "@/components/thread-view";
import { FaceTimeButton } from "@/components/facetime-button";
import { openThreadSearch } from "@/lib/thread-search";
import { goBackOrHome } from "@/lib/back-navigation";
import type { JumpTarget } from "@/hooks/use-messages";

function HeaderTitle({
  guid,
  name,
  isGroup,
  memberCount,
  hasGroupPhoto,
}: {
  guid: string;
  name: string;
  isGroup: boolean;
  memberCount?: number;
  hasGroupPhoto?: boolean;
}) {
  const theme = useTheme();
  const dmAddress = !isGroup ? (guid.split(";").pop() ?? null) : null;
  // A deep link carries no name; the directory knows it once it loads.
  const known = useChatDirectory()?.find((chat) => chat.guid === guid);
  const title = known?.displayName ?? name;
  return (
    <View style={headerStyles.container}>
      {isGroup ? (
        <GroupPhotoAvatar guid={guid} size={32} iconSize={15} hasPhoto={hasGroupPhoto} />
      ) : (
        <PersonAvatar address={dmAddress} name={name} size={32} />
      )}
      <View style={headerStyles.identityText}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
          {title}
        </Text>
        {isGroup && memberCount !== undefined && memberCount > 0 && (
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{memberCount} people</Text>
        )}
        {dmAddress && (
          <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 11 }}>{formatAddress(dmAddress)}</Text>
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
    // Leaves room for the back chevron and the three header actions at 390pt.
    maxWidth: 170,
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
    hasGroupPhoto?: string;
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
          headerTitleAlign: "left",
          headerLeft: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBackOrHome(router)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="chevron-back" size={26} color={theme.accent} />
            </Pressable>
          ),
          headerTitle: () => (
            <HeaderTitle
              guid={params.guid}
              name={params.name ?? (isGroup ? "Group conversation" : formatAddress(params.guid.split(";").pop() ?? params.guid))}
              isGroup={isGroup}
              memberCount={params.count ? Number(params.count) : undefined}
              hasGroupPhoto={params.hasGroupPhoto === "1"}
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
              <Pressable accessibilityRole="button" accessibilityLabel="Search conversation" onPress={() => openThreadSearch()} hitSlop={8}>
                <Ionicons name="search" size={22} color={theme.accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Details"
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
