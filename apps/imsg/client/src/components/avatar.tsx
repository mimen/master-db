import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { avatarUrl, groupPhotoUrl } from "@/lib/api";
import { initials } from "@/lib/format";
import type { ChatSummary } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";

// "Muted Editorial" palette, saturation nudged up: 20 evenly-spaced hues drawn
// as a soft diagonal gradient — richer than a rainbow, still grown-up.
const PALETTE = { s1: 54, l1: 58, shift: 30, s2: 58, l2: 47 } as const;

/** Deterministic per-contact gradient. A 20-slot palette keyed off the address. */
function avatarColor(key: string): { start: string; end: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = (h % 20) * 18;
  const hue2 = (hue + PALETTE.shift) % 360;
  return {
    start: `hsl(${hue}, ${PALETTE.s1}%, ${PALETTE.l1}%)`,
    end: `hsl(${hue2}, ${PALETTE.s2}%, ${PALETTE.l2}%)`,
    // Generated avatar initials always need to contrast the generated gradient,
    // never the app theme — theme-invariant by design.
    fg: PALETTE.l1 > 64 ? "rgba(0,0,0,0.72)" : "#ffffff",
  };
}

/**
 * The base primitive: a gradient-initials circle with the cached contact
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
  const color = avatarColor(address ?? name);
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <LinearGradient
        colors={[color.start, color.end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={{ fontSize: size * 0.34, fontWeight: "600", color: color.fg }}>
        {initials(name)}
      </Text>
      {address && (
        <Image
          source={{ uri: avatarUrl(address) }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          contentFit="cover"
          transition={80}
          // Without a recycling key a reused list cell shows the previous
          // contact's face until this one decodes.
          recyclingKey={address}
          cachePolicy="memory-disk"
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
        recyclingKey={chat.guid}
        cachePolicy="memory-disk"
      />
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
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.backgroundElement },
      ]}
    >
      <Ionicons name="people" size={iconSize ?? size * 0.47} color={theme.textSecondary} />
      <Image
        source={{ uri: groupPhotoUrl(guid) }}
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        contentFit="cover"
        transition={80}
        recyclingKey={guid}
        cachePolicy="memory-disk"
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
