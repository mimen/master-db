import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { avatarUrl, groupPhotoUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import type { ChatSummary } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";

function PersonAvatar({
  address,
  name,
  size,
}: {
  address: string | null;
  name: string;
  size: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.backgroundElement,
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.34, fontWeight: "600", color: theme.textSecondary }}>
        {initials(name)}
      </Text>
      {address && (
        <Image
          source={{ uri: avatarUrl(address) }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={80}
        />
      )}
    </View>
  );
}

export function ChatAvatar({ chat, size }: { chat: ChatSummary; size: number }) {
  if (!chat.isGroup) {
    return (
      <PersonAvatar
        address={chat.participants[0]?.address ?? null}
        name={chat.displayName}
        size={size}
      />
    );
  }
  const sorted = [...chat.participants].sort(
    (a, b) => Number(b.name !== null) - Number(a.name !== null),
  );
  const back = sorted[0];
  const front = sorted[1] ?? sorted[0];
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", top: 0, right: 0 }}>
        <PersonAvatar
          address={back?.address ?? null}
          name={back?.name ?? back?.address ?? "?"}
          size={size * 0.68}
        />
      </View>
      <View style={{ position: "absolute", bottom: 0, left: 0 }}>
        <PersonAvatar
          address={front?.address ?? null}
          name={front?.name ?? front?.address ?? "?"}
          size={size * 0.58}
        />
      </View>
      <Image
        source={{ uri: groupPhotoUrl(chat.guid) }}
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        contentFit="cover"
        transition={80}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
