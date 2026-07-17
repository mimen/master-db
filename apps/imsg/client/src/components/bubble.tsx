import { memo } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { attachmentUrl, avatarUrl } from "@/lib/api";
import { formatBubbleTime, initials } from "@/lib/format";
import type { Message } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";
import { LinkPreviewCard, firstUrl } from "./link-preview-card";

export const TAPBACK_EMOJI = new Map([
  ["love", "❤️"],
  ["like", "👍"],
  ["dislike", "👎"],
  ["laugh", "😂"],
  ["emphasize", "‼️"],
  ["question", "❓"],
]);

function Attachments({ message }: { message: Message }) {
  return (
    <View style={{ gap: 6 }}>
      {message.attachments.map((att) => {
        const url = attachmentUrl(att.guid);
        if (att.mimeType?.startsWith("image/")) {
          const ratio =
            att.width && att.height && att.width > 0 && att.height > 0
              ? att.width / att.height
              : 4 / 3;
          return (
            <Image
              key={att.guid}
              source={{ uri: url }}
              style={{ width: 220, aspectRatio: ratio, borderRadius: 14 }}
              contentFit="cover"
              transition={100}
            />
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
  onLongPress: (message: Message) => void;
  onRetry: (message: Message) => void;
}

export const Bubble = memo(function Bubble({
  message,
  groupStart,
  groupEnd,
  isGroupChat,
  isLatestOutgoing,
  onLongPress,
  onRetry,
}: BubbleProps) {
  const theme = useTheme();
  const mine = message.isFromMe;
  const senderName = message.sender?.name ?? message.sender?.address ?? "";
  const url = message.text ? firstUrl(message.text) : null;

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
        {!mine && (
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

        <View style={{ maxWidth: "78%", alignItems: mine ? "flex-end" : "flex-start" }}>
          {!mine && isGroupChat && groupStart && senderName !== "" && (
            <Text style={[styles.senderName, { color: theme.textSecondary }]}>{senderName}</Text>
          )}
          <View>
            <Pressable
              onLongPress={() => onLongPress(message)}
              delayLongPress={280}
              style={[
                styles.bubble,
                mine
                  ? { backgroundColor: theme.bubbleMine, borderBottomRightRadius: groupEnd ? 6 : 18 }
                  : { backgroundColor: theme.bubbleTheirs, borderBottomLeftRadius: groupEnd ? 6 : 18 },
                message.pending && { opacity: 0.6 },
                message.failed && { backgroundColor: "rgba(255,69,58,0.25)" },
              ]}
            >
              {message.attachments.length > 0 && <Attachments message={message} />}
              {message.text !== "" && (
                <Text
                  style={{
                    fontSize: 17,
                    lineHeight: 22,
                    color: mine ? "#fff" : theme.bubbleTheirsText,
                  }}
                >
                  {message.text}
                </Text>
              )}
              {url && <LinkPreviewCard url={url} mine={mine} />}
            </Pressable>

            {message.reactions.length > 0 && (
              <View style={[styles.reactionRow, mine ? { left: -10 } : { right: -10 }]}>
                {[...new Set(message.reactions.map((r) => r.type))].map((type) => (
                  <View
                    key={type}
                    style={[styles.reactionChip, { backgroundColor: theme.backgroundElement }]}
                  >
                    <Text style={{ fontSize: 12 }}>{TAPBACK_EMOJI.get(type) ?? type}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {message.failed ? (
            <Pressable onPress={() => onRetry(message)}>
              <Text style={styles.failed}>Failed — tap to retry</Text>
            </Pressable>
          ) : message.pending ? (
            <Text style={[styles.meta, { color: theme.textSecondary }]}>Sending…</Text>
          ) : (
            (groupEnd || message.edited) && (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {message.edited ? "Edited · " : ""}
                {groupEnd ? formatBubbleTime(message.dateCreated) : ""}
                {mine && isLatestOutgoing
                  ? message.dateRead
                    ? " · Read"
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
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
