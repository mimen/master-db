import { memo, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { attachmentUrl, avatarUrl } from "@/lib/api";
import { formatBubbleTime, initials } from "@/lib/format";
import { formatAddress } from "@shared/address";
import type { Message, SpecialContent } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";
import { AudioBubble, VideoBubble } from "./media";
import { useLightbox } from "@/lib/lightbox";
import { useWebContextMenu } from "@/lib/use-web-context-menu";
import { LinkPreviewCard, firstUrl } from "./link-preview-card";

const SPECIAL_META: Record<SpecialContent["kind"], { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  contact: { icon: "person-circle-outline", label: "Contact Card" },
  location: { icon: "location-outline", label: "Shared Location" },
  "apple-cash": { icon: "cash-outline", label: "Apple Cash" },
  poll: { icon: "bar-chart-outline", label: "Poll" },
  unknown: { icon: "cube-outline", label: "App Message" },
};

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Splits text so URLs render as tappable, underlined links (kept inline). */
function linkifyText(text: string, color: string): ReactNode {
  URL_IN_TEXT.lastIndex = 0;
  if (!URL_IN_TEXT.test(text)) return text;
  URL_IN_TEXT.lastIndex = 0;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (let match = URL_IN_TEXT.exec(text); match; match = URL_IN_TEXT.exec(text)) {
    // Trailing punctuation belongs to the sentence, not the URL.
    const raw = match[0].replace(/[.,;:!?)\]>'"]+$/, "");
    if (raw.length === 0) continue;
    const start = match.index;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    parts.push(
      <Text
        key={`${start}-${raw}`}
        style={{ color, textDecorationLine: "underline" }}
        onPress={() => void Linking.openURL(href)}
        suppressHighlighting
      >
        {raw}
      </Text>,
    );
    cursor = start + raw.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** Clean iMessage-style bubble tail via SVG — hugs the bottom outer corner. */
function BubbleTail({ color, mine }: { color: string; mine: boolean }) {
  return (
    <Svg
      width={14}
      height={16}
      viewBox="0 0 14 16"
      style={[styles.tailSvg, mine ? { right: -5 } : { left: -5, transform: [{ scaleX: -1 }] }]}
      pointerEvents="none"
    >
      <Path
        d="M0 0 C0 8 2 14 12 15 C6 15 1 12 1 6 Z"
        fill={color}
      />
    </Svg>
  );
}

function SpecialCard({ special, mine }: { special: SpecialContent; mine: boolean }) {
  const theme = useTheme();
  const meta = SPECIAL_META[special.kind];
  const title = special.kind === "contact" && special.name ? special.name : meta.label;
  const color = mine ? "#fff" : theme.text;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
      <Ionicons name={meta.icon} size={22} color={color} />
      <Text style={{ fontSize: 16, fontWeight: "500", color }}>{title}</Text>
    </View>
  );
}

export const TAPBACK_EMOJI = new Map([
  ["love", "❤️"],
  ["like", "👍"],
  ["dislike", "👎"],
  ["laugh", "😂"],
  ["emphasize", "‼️"],
  ["question", "❓"],
]);

function Attachments({ message, mine }: { message: Message; mine: boolean }) {
  const { width: winW } = useWindowDimensions();
  const openLightbox = useLightbox();
  // Cap thumbnails so desktop doesn't blow them up huge.
  const mediaW = Math.min(260, Math.round(winW * 0.6));
  const images = message.attachments.filter((a) => a.mimeType?.startsWith("image/"));
  return (
    <View style={{ gap: 6 }}>
      {message.attachments.map((att) => {
        const url = attachmentUrl(att.guid);
        if (
          att.mimeType?.startsWith("audio/") ||
          /\.(caf|amr|m4a|mp3|wav)$/i.test(att.filename ?? "")
        ) {
          return <AudioBubble key={att.guid} url={url} mine={mine} />;
        }
        if (att.mimeType?.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(att.filename ?? "")) {
          return <VideoBubble key={att.guid} url={url} />;
        }
        if (att.mimeType?.startsWith("image/")) {
          const ratio =
            att.width && att.height && att.width > 0 && att.height > 0
              ? att.width / att.height
              : 4 / 3;
          return (
            <Pressable
              key={att.guid}
              onPress={() =>
                openLightbox(
                  images.map((i) => ({ url: attachmentUrl(i.guid), isVideo: false })),
                  images.findIndex((i) => i.guid === att.guid),
                )
              }
            >
              <Image
                source={{ uri: url }}
                style={{ width: mediaW, aspectRatio: ratio, borderRadius: 14 }}
                contentFit="cover"
                transition={100}
              />
            </Pressable>
          );
        }
        return (
          <Pressable key={att.guid} onPress={() => void Linking.openURL(url)}>
            <Text style={styles.attachmentLink}>{att.filename ?? "Attachment"}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface BubbleProps {
  message: Message;
  groupStart: boolean;
  groupEnd: boolean;
  isGroupChat: boolean;
  isLatestOutgoing: boolean;
  highlighted?: boolean;
  onLongPress: (message: Message, anchor?: { x: number; y: number }) => void;
  onRetry: (message: Message) => void;
  onShowReactions: (message: Message) => void;
}

export const Bubble = memo(function Bubble({
  message,
  groupStart,
  groupEnd,
  isGroupChat,
  isLatestOutgoing,
  highlighted = false,
  onLongPress,
  onRetry,
  onShowReactions,
}: BubbleProps) {
  const theme = useTheme();
  const { width: winW } = useWindowDimensions();
  const contextRef = useWebContextMenu<View>((anchor) => onLongPress(message, anchor));
  const [showTime, setShowTime] = useState(false);
  const mine = message.isFromMe;
  // SMS (green bubble) vs iMessage (blue).
  const mineColor = message.service === "SMS" ? "#34C759" : theme.bubbleMine;
  const senderName =
    message.sender?.name ?? (message.sender?.address ? formatAddress(message.sender.address) : "");
  // Cap bubble width so long messages don't stretch across a wide desktop pane.
  const bubbleMaxWidth = winW >= 768 ? Math.min(winW * 0.5, 560) : "78%";
  const url = message.text ? firstUrl(message.text) : null;
  // A persisted non-zero error is Apple's delivery failure (e.g. the iMessage
  // half of a service-split send) — surface it like an optimistic failure.
  const notDelivered = message.failed || (mine && (message.error ?? 0) !== 0);
  // Tail only on the last text bubble of a group (not on media/pending/failed).
  const hasTail = groupEnd && !message.pending && !notDelivered && message.text !== "";

  return (
    <View style={{ paddingHorizontal: 14, marginBottom: groupEnd ? 8 : 2 }}>
      {message.replyToPreview !== null && (
        <View style={{ alignItems: message.replyToFromMe ? "flex-end" : "flex-start" }}>
          <View
            style={[
              styles.quote,
              { borderColor: message.replyToFromMe ? theme.bubbleMine : theme.textSecondary },
            ]}
          >
            <Text
              numberOfLines={2}
              style={{
                fontSize: 13,
                color: message.replyToFromMe ? theme.bubbleMine : theme.textSecondary,
              }}
            >
              {message.replyToPreview || "Original message"}
            </Text>
          </View>
          <View
            style={[
              styles.connector,
              { borderColor: theme.textSecondary },
              mine
                ? { alignSelf: "flex-end", marginRight: 22, borderBottomRightRadius: 12, borderLeftWidth: 0 }
                : { alignSelf: "flex-start", marginLeft: 22, borderBottomLeftRadius: 12, borderRightWidth: 0 },
            ]}
          />
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          justifyContent: mine ? "flex-end" : "flex-start",
          alignItems: "flex-end",
          gap: 6,
        }}
      >
        {/* Avatar gutter only in group threads — Apple shows none in 1:1 DMs. */}
        {!mine && isGroupChat && (
          <View style={{ width: 28 }}>
            {groupEnd && (
              <View style={[styles.smallAvatar, { backgroundColor: theme.backgroundElement }]}>
                <Text style={{ fontSize: 9, fontWeight: "600", color: theme.textSecondary }}>
                  {initials(senderName)}
                </Text>
                {message.sender?.address && (
                  <Image
                    source={{ uri: avatarUrl(message.sender.address) }}
                    style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
                    contentFit="cover"
                  />
                )}
              </View>
            )}
          </View>
        )}

        <View style={{ maxWidth: bubbleMaxWidth, alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}>
          {!mine && isGroupChat && groupStart && senderName !== "" && (
            <Text style={[styles.senderName, { color: theme.textSecondary }]}>{senderName}</Text>
          )}

          {/* Media and link cards render bare — no colored bubble around them. */}
          {message.attachments.length > 0 && <Attachments message={message} mine={mine} />}
          {url && <LinkPreviewCard url={url} mine={mine} />}

          <View>
            {(message.text !== "" || message.special) && (
              <Pressable
                ref={contextRef as never}
                onPress={() => setShowTime((v) => !v)}
                onLongPress={() => onLongPress(message)}
                delayLongPress={280}
                style={[
                  styles.bubble,
                  highlighted && styles.highlighted,
                  { backgroundColor: mine ? mineColor : theme.bubbleTheirs },
                  hasTail && (mine ? styles.bubbleTailMine : styles.bubbleTailTheirs),
                  message.pending && { opacity: 0.6 },
                  notDelivered && { backgroundColor: "rgba(255,69,58,0.25)" },
                ]}
              >
                {message.special && <SpecialCard special={message.special} mine={mine} />}
                {message.text !== "" && (
                  <Text
                    selectable
                    style={{
                      fontSize: 17,
                      lineHeight: 22,
                      color: mine ? "#fff" : theme.bubbleTheirsText,
                      // Break long unbroken strings (URLs) so they never overflow.
                      ...(Platform.OS === "web"
                        ? ({ overflowWrap: "anywhere", wordBreak: "break-word" } as object)
                        : {}),
                    }}
                  >
                    {linkifyText(message.text, mine ? "#fff" : theme.accent)}
                  </Text>
                )}
                {hasTail && <BubbleTail color={mine ? mineColor : theme.bubbleTheirs} mine={mine} />}
              </Pressable>
            )}

            {message.reactions.length > 0 && (
              <View style={[styles.reactionRow, mine ? { left: -10 } : { right: -10 }]}>
                {Object.entries(
                  message.reactions.reduce<Record<string, number>>((acc, r) => {
                    acc[r.type] = (acc[r.type] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([type, count]) => (
                  <Pressable
                    key={type}
                    onPress={() => onShowReactions(message)}
                    style={[styles.reactionChip, { backgroundColor: theme.backgroundElement }]}
                  >
                    <Text style={{ fontSize: 12 }}>
                      {TAPBACK_EMOJI.get(type) ?? type}
                      {count > 1 ? ` ${count}` : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {notDelivered ? (
            <Pressable onPress={() => onRetry(message)}>
              <Text style={styles.failed}>Not Delivered — tap to retry</Text>
            </Pressable>
          ) : message.pending ? (
            <Text style={[styles.meta, { color: theme.textSecondary }]}>Sending…</Text>
          ) : (
            (groupEnd || message.edited || showTime) && (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {message.edited ? "Edited · " : ""}
                {groupEnd || showTime ? formatBubbleTime(message.dateCreated) : ""}
                {mine && isLatestOutgoing
                  ? message.dateRead
                    ? ` · Read ${formatBubbleTime(message.dateRead)}`
                    : message.dateDelivered
                      ? " · Delivered"
                      : " · Sent"
                  : ""}
              </Text>
            )
          )}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  highlighted: {
    borderWidth: 2,
    borderColor: "#0A84FF",
  },
  tailSvg: {
    position: "absolute",
    bottom: 0,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  bubbleTailMine: {
    borderBottomRightRadius: 4,
  },
  bubbleTailTheirs: {
    borderBottomLeftRadius: 4,
  },
  quote: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "70%",
  },
  connector: {
    width: 20,
    height: 12,
    borderWidth: 1.5,
    borderTopWidth: 0,
  },
  smallAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  senderName: {
    fontSize: 11,
    marginBottom: 2,
    marginLeft: 4,
  },
  reactionRow: {
    position: "absolute",
    top: -12,
    flexDirection: "row",
    gap: 2,
  },
  reactionChip: {
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  meta: {
    fontSize: 11,
    marginTop: 2,
    marginHorizontal: 4,
  },
  failed: {
    fontSize: 12,
    color: "#FF453A",
    fontWeight: "600",
    marginTop: 2,
  },
  attachmentLink: {
    fontSize: 14,
    textDecorationLine: "underline",
    color: "#0A84FF",
  },
});
