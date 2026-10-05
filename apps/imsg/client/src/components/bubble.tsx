import { memo, useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { useConvexConnectionState } from "convex/react";
import { deliveryState } from "@/lib/delivery-state";
import { openExternalUrl } from "@/lib/external-link";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { attachmentThumbnailUrl, attachmentUrl } from "@/lib/api";
import { formatAddress } from "@shared/address";
import type { Message, SpecialContent } from "@shared/types";
import type { MentionAnnotation } from "@shared/mentions";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { HOVER_DIM, Radii } from "@/constants/theme";
import { AudioBubble, FileCard, VideoBubble, MediaUnavailable } from "./media";
import { PersonAvatar } from "./avatar";
import { useLightbox } from "@/lib/lightbox";
import { useWebContextMenu } from "@/lib/use-web-context-menu";
import { LinkPreviewCard, firstUrl } from "./link-preview-card";
import { receiptText } from "./message-meta";

const SPECIAL_META: Record<SpecialContent["kind"], { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  contact: { icon: "person-circle-outline", label: "Contact card" },
  location: { icon: "location-outline", label: "Shared location" },
  "apple-cash": { icon: "cash-outline", label: "Apple Cash" },
  poll: { icon: "bar-chart-outline", label: "Poll" },
  unknown: { icon: "cube-outline", label: "App Message" },
};

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Splits text so URLs render as tappable, underlined links (kept inline). */
function linkifyText(text: string, color: string, keyPrefix = "text"): ReactNode {
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
        key={`${keyPrefix}-${start}-${raw}`}
        // In-bubble links stay underlined at rest; hover dims via the shared
        // CSS utility (works on both bubble colors, no per-scheme color swap).
        {...({ dataSet: { hoverDim: "true" } } as object)}
        accessibilityRole="link"
        style={{ color, textDecorationLine: "underline" }}
        onPress={() => void openExternalUrl(href)}
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

function renderMessageText(
  text: string,
  mentions: readonly MentionAnnotation[],
  textColor: string,
  linkColor: string,
): ReactNode {
  if (mentions.length === 0) return linkifyText(text, linkColor);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start < cursor || mention.start + mention.length > text.length) continue;
    if (mention.start > cursor) {
      parts.push(linkifyText(text.slice(cursor, mention.start), linkColor, `segment-${cursor}`));
    }
    parts.push(
      <Text key={`mention-${mention.start}-${mention.address}`} style={{ color: textColor, fontWeight: "700" }}>
        {text.slice(mention.start, mention.start + mention.length)}
      </Text>,
    );
    cursor = mention.start + mention.length;
  }
  if (cursor < text.length) parts.push(linkifyText(text.slice(cursor), linkColor, `segment-${cursor}`));
  return parts;
}

function SpecialCard({ special, mine }: { special: SpecialContent; mine: boolean }) {
  const theme = useTheme();
  const meta = SPECIAL_META[special.kind];
  const title = special.kind === "contact" && special.name ? special.name : meta.label;
  const color = mine ? theme.onAccent : theme.text;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
      <Ionicons name={meta.icon} size={22} color={color} />
      <Text style={{ fontSize: 16, fontWeight: "500", color }}>{title}</Text>
    </View>
  );
}

export const TAPBACK_LABEL: Record<string, string> = {
  love: "Love", like: "Like", dislike: "Dislike", laugh: "Laugh", emphasize: "Emphasize", question: "Question",
};

export const TAPBACK_EMOJI = new Map([
  ["love", "❤️"],
  ["like", "👍"],
  ["dislike", "👎"],
  ["laugh", "😂"],
  ["emphasize", "‼️"],
  ["question", "❓"],
]);

/** Holds still under a thread image until its thumbnail paints. */
function ImageSkeleton() {
  const theme = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.skeleton }]} />;
}

function Attachments({ message, mine, paneWidth = 0 }: { message: Message; mine: boolean; paneWidth?: number }) {
  const theme = useTheme();
  const { width: winW } = useLayoutMode();
  const openLightbox = useLightbox();
  // Absent means a first load. A retry bumps the attempt, which remounts the Image.
  const [imageState, setImageState] = useState<Record<string, { status: "loading" | "loaded" | "failed"; attempt: number }>>({});
  const setImage = (guid: string, status: "loading" | "loaded" | "failed", nextAttempt = false) =>
    setImageState((current) => {
      const attempt = (current[guid]?.attempt ?? 0) + (nextAttempt ? 1 : 0);
      return { ...current, [guid]: { status, attempt } };
    });
  // Cap thumbnails so desktop doesn't blow them up huge — pane-relative too.
  const base = paneWidth > 0 ? paneWidth : winW;
  const mediaW = Math.min(260, Math.round(base * 0.6));
  const images = message.attachments.filter((a) => a.mimeType?.startsWith("image/"));
  return (
    <View style={{ gap: 6 }}>
      {message.attachments.map((att) => {
        const url = attachmentUrl(att);
        const thumbnail = attachmentThumbnailUrl(att, mediaW);
        if (!url && !(att.mimeType?.startsWith("image/") && thumbnail)) return <MediaUnavailable key={att.guid} onMac={att.onMac} />;
        if (
          att.mimeType?.startsWith("audio/") ||
          /\.(caf|amr|m4a|mp3|wav)$/i.test(att.filename ?? "")
        ) {
          return <AudioBubble key={att.guid} guid={att.guid} chatGuid={message.chatGuid} url={url!} mine={mine} />;
        }
        if (att.mimeType?.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(att.filename ?? "")) {
          return (
            <VideoBubble
              key={att.guid}
              url={url!}
              width={Math.min(230, mediaW)}
              sourceWidth={att.width}
              sourceHeight={att.height}
            />
          );
        }
        if (att.mimeType?.startsWith("image/")) {
          const ratio =
            att.width && att.height && att.width > 0 && att.height > 0
              ? att.width / att.height
              : 4 / 3;
          const state = imageState[att.guid];
          if (state?.status === "failed") {
            return (
              <Pressable
                key={att.guid}
                accessibilityRole="button"
                accessibilityLabel="Photo unavailable. Retry"
                onPress={() => setImage(att.guid, "loading", true)}
                style={[styles.imageUnavailable, { backgroundColor: theme.backgroundElement }]}
              >
                <Ionicons name="image-outline" size={16} color={theme.textSecondary} />
                <Text style={[styles.imageUnavailableText, { color: theme.textSecondary }]}>Photo unavailable</Text>
                <Ionicons name="refresh" size={14} color={theme.accent} />
              </Pressable>
            );
          }
          const tile = { width: mediaW, aspectRatio: ratio, borderRadius: 14 };
          return (
            <Pressable
              key={att.guid}
              accessibilityRole="button"
              accessibilityLabel="Open photo"
              onPress={() =>
                openLightbox(
                  images.map((i) => ({ ...i, isVideo: false })),
                  images.findIndex((i) => i.guid === att.guid),
                )
              }
              style={[tile, { overflow: "hidden" }]}
            >
              {state?.status !== "loaded" && <ImageSkeleton />}
              <Image
                key={state?.attempt ?? 0}
                source={{ uri: thumbnail! }}
                style={tile}
                contentFit="cover"
                transition={150}
                onLoad={() => setImage(att.guid, "loaded")}
                onError={() => setImage(att.guid, "failed")}
              />
            </Pressable>
          );
        }
        return (
          <FileCard
            key={att.guid}
            filename={att.filename ?? "Attachment"}
            bytes={att.totalBytes}
            onPress={() => void openExternalUrl(url!)}
          />
        );
      })}
    </View>
  );
}

interface BubbleProps {
  message: Message;
  /** Rendering pane's width — bubbles cap against THIS, not the window. */
  paneWidth?: number;
  groupStart: boolean;
  groupEnd: boolean;
  isGroupChat: boolean;
  isLatestOutgoing: boolean;
  /** dateCreated of the chat's newest inbound message, evidence a stale error code delivered. */
  latestInboundAt: number | null;
  highlighted?: boolean;
  onLongPress: (message: Message, anchor?: { x: number; y: number }) => void;
  onRetry: (message: Message) => void;
  /** Resend the failed message over SMS. The button shows only when this is given. */
  onSendAsText?: (message: Message) => void;
  onShowReactions: (message: Message) => void;
}

/** iMessage stays silent while a send is quick; only a send still out after this long says so. */
const SLOW_SEND_MS = 1500;

function useSlowSend(pending: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), SLOW_SEND_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  return slow;
}

export const Bubble = memo(function Bubble({
  message,
  paneWidth = 0,
  groupStart,
  groupEnd,
  isGroupChat,
  isLatestOutgoing,
  latestInboundAt,
  highlighted = false,
  onLongPress,
  onRetry,
  onSendAsText,
  onShowReactions,
}: BubbleProps) {
  const theme = useTheme();
  const { width: winW, wide } = useLayoutMode();
  const contextRef = useWebContextMenu<View>((anchor) => onLongPress(message, anchor));
  const [showTime, setShowTime] = useState(false);
  const slowSend = useSlowSend(message.pending === true);
  const mine = message.isFromMe;
  const mineColor = message.service === "SMS" ? theme.sms : theme.bubbleMine;
  const senderName =
    message.sender?.name ?? (message.sender?.address ? formatAddress(message.sender.address) : "");
  const groupGutter = !mine && isGroupChat;
  // A share of the reading column the thread passes in: 64% on desk (58% beside a group avatar), 76% on phone.
  const share = wide ? (groupGutter ? 0.58 : 0.64) : 0.76;
  const bubbleMaxWidth = paneWidth > 0 ? paneWidth * share : wide ? Math.min(winW * 0.5, 520) : "76%";
  const url = message.text ? firstUrl(message.text) : null;
  const delivery = deliveryState(message, latestInboundAt, Date.now());
  const notDelivered = delivery === "failed";
  const caption = { fontSize: wide ? 11 : 12, color: theme.textTertiary };
  const tapbacks = Object.entries(
    message.reactions.reduce<Record<string, number>>((acc, r) => {
      const glyph = r.type === "emoji" ? (r.emoji ?? "🙂") : r.type;
      acc[glyph] = (acc[glyph] ?? 0) + 1;
      return acc;
    }, {}),
  );

  return (
    <View
      style={{
        // Tapback chips overhang the bubble top; reserve that headroom so they never slide under the neighbor.
        marginTop: tapbacks.length > 0 ? 22 : groupStart ? (wide ? 10 : 9) : 3,
      }}
    >
      {groupGutter && groupStart && senderName !== "" && (
        <Text style={[styles.senderName, { fontSize: wide ? 11.5 : 13, color: theme.textTertiary }]}>{senderName}</Text>
      )}

      {message.replyToPreview !== null && (
        <View
          style={[
            styles.quote,
            {
              borderLeftColor: theme.dividerStrong,
              alignSelf: mine ? "flex-end" : "flex-start",
              marginLeft: groupGutter ? AVATAR + GUTTER_GAP : 0,
            },
          ]}
        >
          <Text numberOfLines={2} style={{ fontSize: wide ? 12.5 : 15, color: theme.textSecondary }}>
            {message.replyToFromMe && <Text style={{ fontWeight: "600", color: theme.text }}>You </Text>}
            {message.replyToPreview || "Original message"}
          </Text>
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          justifyContent: mine ? "flex-end" : "flex-start",
          alignItems: "flex-end",
          gap: GUTTER_GAP,
        }}
      >
        {/* Avatar gutter only in group threads; Apple shows none in 1:1 DMs. */}
        {groupGutter && (
          <View style={{ width: AVATAR }}>
            {groupEnd && (
              <PersonAvatar address={message.sender?.address ?? null} name={senderName} size={AVATAR} />
            )}
          </View>
        )}

        <View style={{ maxWidth: bubbleMaxWidth, alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}>
          {/* Media and link cards render bare, no colored bubble around them. */}
          {message.attachments.length > 0 && (
            <Attachments message={message} mine={mine} paneWidth={paneWidth} />
          )}
          {url && <LinkPreviewCard url={url} mine={mine} />}

          <View>
            {(message.text !== "" || message.special) && (
              <Pressable
                ref={contextRef as never}
                testID="message-bubble"
                role="button"
                aria-label={`${mine ? "You" : senderName || "Them"}: ${message.text || "attachment"}`}
                onPress={() => setShowTime((v) => !v)}
                onLongPress={() => onLongPress(message)}
                delayLongPress={280}
                style={[
                  styles.bubble,
                  wide ? styles.bubbleDesk : styles.bubblePhone,
                  mine
                    ? { backgroundColor: mineColor, borderColor: mineColor }
                    : { backgroundColor: theme.bubbleTheirs, borderColor: theme.bubbleTheirsBorder },
                  !groupEnd && (mine ? styles.runBelowMine : styles.runBelowTheirs),
                  !groupStart && (mine ? styles.runAboveMine : styles.runAboveTheirs),
                  highlighted && { borderWidth: 2, borderColor: theme.accent },
                ]}
              >
                {message.special && <SpecialCard special={message.special} mine={mine} />}
                {message.text !== "" && (
                  <Text
                    selectable
                    style={{
                      fontSize: wide ? 14 : 17,
                      lineHeight: wide ? 19 : 22,
                      color: mine ? theme.onAccent : theme.bubbleTheirsText,
                      // Break long unbroken strings (URLs) so they never overflow.
                      ...(Platform.OS === "web"
                        ? ({ overflowWrap: "anywhere", wordBreak: "break-word" } as object)
                        : {}),
                    }}
                  >
                    {renderMessageText(
                      message.text,
                      message.mentions ?? [],
                      mine ? theme.onAccent : theme.bubbleTheirsText,
                      mine ? theme.onAccent : theme.accent,
                    )}
                  </Text>
                )}
              </Pressable>
            )}

            {tapbacks.length > 0 && (
              <View style={[styles.reactionRow, mine ? { left: -18 } : { right: -14 }]}>
                {tapbacks.map(([type, count]) => (
                  <Pressable
                    key={type}
                    accessibilityRole="button"
                    accessibilityLabel={`${TAPBACK_LABEL[type] ?? type}${count > 1 ? `, ${count}` : ""}`}
                    onPress={() => onShowReactions(message)}
                    style={[styles.reactionChip, { backgroundColor: theme.tapbackBg, borderColor: theme.tapbackBorder }]}
                  >
                    <Text style={{ fontSize: 12 }}>{TAPBACK_EMOJI.get(type) ?? type}</Text>
                    {count > 1 && <Text style={[styles.reactionCount, { color: theme.textSecondary }]}>{count}</Text>}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {notDelivered ? (
            <View style={styles.failedRow}>
              <Text style={[styles.failedLabel, { color: theme.destructive }]}>Not delivered</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry sending"
                onPress={() => onRetry(message)}
                hitSlop={6}
                style={({ hovered, pressed }) => [(hovered || pressed) && { opacity: HOVER_DIM }]}
              >
                <Text style={[styles.failedAction, { color: theme.text }]}>Retry</Text>
              </Pressable>
              {onSendAsText && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onSendAsText(message)}
                  hitSlop={6}
                  style={({ hovered, pressed }) => [(hovered || pressed) && { opacity: HOVER_DIM }]}
                >
                  <Text style={[styles.failedAction, { color: theme.text }]}>Send as text</Text>
                </Pressable>
              )}
            </View>
          ) : delivery === "uncertain" ? (
            <Text style={[styles.meta, caption]}>May not have delivered</Text>
          ) : mine && isLatestOutgoing && message.pending && slowSend ? (
            <PendingReceipt style={[styles.meta, caption]} />
          ) : (
            <Receipt style={[styles.meta, caption]} text={receiptText({ message, isLatestOutgoing, slowSend, showTime })} />
          )}
        </View>

        {notDelivered && (
          <Ionicons name="alert-circle-outline" size={20} color={theme.destructive} style={styles.failedIcon} accessibilityElementsHidden />
        )}
      </View>
    </View>
  );
});

function Receipt({ text, style }: { text: string | null; style: StyleProp<TextStyle> }) {
  return text === null ? null : <Text style={style}>{text}</Text>;
}

/** A send still out after the slow-send delay names why when the connection is down. */
function PendingReceipt({ style }: { style: StyleProp<TextStyle> }) {
  const { isWebSocketConnected } = useConvexConnectionState();
  return <Text style={style}>{isWebSocketConnected ? "Sending…" : "Waiting for connection"}</Text>;
}

const AVATAR = 30;
const GUTTER_GAP = 8;

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 18,
    borderWidth: 1,
  },
  // Padding is one point under the mockup on each side to make room for the 1px border.
  bubbleDesk: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 7,
  },
  bubblePhone: {
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 8,
  },
  runBelowMine: { borderBottomRightRadius: 5 },
  runAboveMine: { borderTopRightRadius: 5 },
  runBelowTheirs: { borderBottomLeftRadius: 5 },
  runAboveTheirs: { borderTopLeftRadius: 5 },
  quote: {
    borderLeftWidth: 2,
    paddingLeft: 9,
    paddingVertical: 1,
    marginTop: 6,
    marginBottom: 4,
    maxWidth: "56%",
  },
  senderName: {
    marginTop: 8,
    marginBottom: 3,
    marginLeft: AVATAR + GUTTER_GAP + 6,
  },
  reactionRow: {
    position: "absolute",
    top: -16,
    flexDirection: "row",
    gap: 2,
  },
  reactionChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
    height: 24,
    justifyContent: "center",
    minWidth: 24,
    paddingHorizontal: 6,
  },
  reactionCount: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  meta: {
    marginBottom: 2,
    marginHorizontal: 4,
  },
  failedRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 4,
  },
  failedLabel: {
    fontSize: 11.5,
    fontWeight: "500",
  },
  failedAction: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  failedIcon: {
    alignSelf: "center",
    marginBottom: 18,
  },
  imageUnavailable: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: Radii.card,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  imageUnavailableText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
