import { useState } from "react";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { avatarUrl, groupPhotoUrl } from "@/lib/api";
import { useQuery } from "convex/react";
import { commaApi } from "@/lib/convex-api";
import { initials } from "@/lib/format";
import { useWhoIs, type Person } from "@/lib/identity";
import type { ChatSummary } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";


/**
 * The base primitive: a neutral initials circle with the cached contact
 * photo (if any) overlaid on top. Every 1:1 avatar in the app — inbox rows,
 * headers, hero profile views, sender gutters — renders through this; do not
 * hand-roll another initials-circle-plus-photo block, extend this one.
 */
export function PersonAvatar({
  address,
  name,
  size,
}: {
  address: string | null;
  name: string;
  size: number;
}) {
  const identity = useWhoIs(address);
  const person: (Person & { photoUrl?: string | null }) | undefined = identity?.found ? identity.person : undefined;
  const photoUrl = person?.photoUrl;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const uri = address ? avatarUrl(address, photoUrl === failedPhoto ? null : photoUrl) : undefined;
  const theme = useTheme();
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.avatar[avatarSlot(address ?? name, theme.avatar.length)],
        },
      ]}
    >
      <Text style={{ fontSize: Math.round(size * 0.36), fontWeight: "600", letterSpacing: 0.2, color: theme.avatarText }}>
        {initials(name)}
      </Text>
      {uri ? (
        <Image
          source={{ uri }}
          onError={() => { if (photoUrl) setFailedPhoto(photoUrl); }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={80}
          // Without a recycling key a reused list cell shows the previous
          // contact's face until this one decodes.
          recyclingKey={uri}
          cachePolicy="memory-disk"
        />
      ) : null}
    </View>
  );
}

/** A stable ramp slot per contact, so neighbors differ by a shade without carrying meaning. */
export function avatarSlot(key: string, slots: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % slots;
}

export function ChatAvatar({ chat, size }: { chat: ChatSummary; size: number }) {
  const theme = useTheme();
  const ringColor = theme.background;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const uri = groupPhotoUrl(chat);
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
  const first = sorted[0];
  const second = sorted[1] ?? sorted[0];
  const face = Math.round(size * 0.6);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <PersonAvatar
          address={first?.address ?? null}
          name={first?.name ?? first?.address ?? "?"}
          size={face}
        />
      </View>
      <View style={[styles.ring, { position: "absolute", bottom: -2, right: -2, borderColor: ringColor }]}>
        <PersonAvatar
          address={second?.address ?? null}
          name={second?.name ?? second?.address ?? "?"}
          size={face}
        />
      </View>
      {uri && uri !== failedPhoto ? (
        <Image
          source={{ uri }}
          onError={() => setFailedPhoto(uri)}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={80}
          recyclingKey={chat.guid}
          cachePolicy="memory-disk"
        />
      ) : null}
    </View>
  );
}

const STACK_RING = 2;

/** Layout width of an overlapping group stack, including the ring around each face. */
export function groupAvatarStackWidth(size: number, count: number): number {
  const n = Math.max(0, Math.min(3, count));
  if (n === 0) return size;
  const av = Math.round(size * 0.66);
  const overlap = Math.round(av * 0.42);
  const face = av + STACK_RING * 2;
  return face + (n - 1) * (face - overlap);
}

/** Overlapping member avatars for a group, Apple-style (up to 3). */
export function GroupAvatarStack({ chat, size }: { chat: ChatSummary; size: number }) {
  const theme = useTheme();
  const members = [...chat.participants]
    .sort((a, b) => Number(b.name !== null) - Number(a.name !== null))
    .slice(0, 3);
  if (members.length === 0) return <ChatAvatar chat={chat} size={size} />;
  const av = Math.round(size * 0.66);
  const overlap = Math.round(av * 0.42);
  const width = groupAvatarStackWidth(size, members.length);
  return (
    <View style={{ width, height: size, flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
      {members.map((m, i) => (
        <View
          key={m.address}
          style={{
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: members.length - i,
            borderRadius: (av + STACK_RING * 2) / 2,
            borderWidth: STACK_RING,
            borderColor: theme.background,
          }}
        >
          <PersonAvatar address={m.address} name={m.name ?? m.address ?? "?"} size={av} />
        </View>
      ))}
    </View>
  );
}

/**
 * Group avatar for call sites that only know a chat guid — no participant
 * list to build ChatAvatar's stacked-circle art from (e.g. the thread
 * header, which is fed by route params). Falls back to a people glyph
 * behind the cached group photo.
 */
export function GroupPhotoAvatar({
  guid,
  size,
  iconSize,
}: {
  guid: string;
  size: number;
  iconSize?: number;
  hasPhoto?: boolean;
}) {
  const theme = useTheme();
  const conversation = useQuery(commaApi.resolveChat, { chatGuid: guid });
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const uri = conversation ? groupPhotoUrl(conversation) : null;
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.backgroundElement },
      ]}
    >
      <Ionicons name="people" size={iconSize ?? size * 0.47} color={theme.textSecondary} />
      {uri && uri !== failedPhoto ? (
        <Image
          source={{ uri }}
          onError={() => setFailedPhoto(uri)}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={80}
          recyclingKey={guid}
          cachePolicy="memory-disk"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderRadius: 999, borderWidth: 2 },
  circle: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
