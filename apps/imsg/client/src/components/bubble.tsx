import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { deliveryState } from "@/lib/delivery-state";
import { openExternalUrl } from "@/lib/external-link";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { attachmentThumbnailUrl, attachmentUrl } from "@/lib/api";
import { formatBubbleTime } from "@/lib/format";
import { formatAddress } from "@shared/address";
import type { Message, SpecialContent } from "@shared/types";
import type { MentionAnnotation } from "@shared/mentions";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { CardShadow, HOVER_DIM, Radii, Type } from "@/constants/theme";
import { AudioBubble, VideoBubble, MediaUnavailable } from "./media";
import { PersonAvatar } from "./avatar";
import { useLightbox } from "@/lib/lightbox";
import { useReducedMotion } from "react-native-reanimated";
import { useWebContextMenu } from "@/lib/use-web-context-menu";
import { LinkPreviewCard, firstUrl } from "./link-preview-card";

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

/** Pulses under a thread image until its thumbnail paints. */
function ImageSkeleton() {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.55)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const native = Platform.OS !== "web";
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: native }),
        Animated.timing(opacity, { toValue: 0.55, duration: 650, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement, opacity }]}
    />
  );
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
          const tile = { width: mediaW, aspectRatio: ratio, borderRadius: Radii.card };
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
          <Pressable key={att.guid} accessibilityRole="link" onPress={() => void openExternalUrl(url!)}>
            <Text {...({ dataSet: { hoverUnderline: "true" } } as object)} style={[styles.attachmentLink, { color: theme.accent }]}>{att.filename ?? "Attachment"}</Text>
          </Pressable>
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
  onShowReactions,
}: BubbleProps) {
  const theme = useTheme();
  const type = useType();
  const { width: winW, wide } = useLayoutMode();
  const contextRef = useWebContextMenu<View>((anchor) => onLongPress(message, anchor));
  const [showTime, setShowTime] = useState(false);
  const slowSend = useSlowSend(message.pending === true);
  const mine = message.isFromMe;
  // SMS (green bubble) vs iMessage (blue).
  const mineColor = message.service === "SMS" ? theme.sms : theme.bubbleMine;
  const senderName =
    message.sender?.name ?? (message.sender?.address ? formatAddress(message.sender.address) : "");
  // Cap bubble width so long messages neither stretch across a wide pane nor
  // overflow a narrow one (Details/Assistant open). Pane-relative when known.
  const bubbleMaxWidth =
    paneWidth > 0
      ? Math.min(paneWidth * 0.72, 560)
      : wide
        ? Math.min(winW * 0.5, 560)
        : "78%";
  const url = message.text ? firstUrl(message.text) : null;
  const delivery = deliveryState(message, latestInboundAt, Date.now());
  const notDelivered = delivery === "failed";
  // Bubbles in a run join on the sender's side: 5px on each corner that meets a neighbor.
  const joined = mine
    ? { borderTopRightRadius: groupStart ? 18 : 5, borderBottomRightRadius: groupEnd ? 18 : 5 }
    : { borderTopLeftRadius: groupStart ? 18 : 5, borderBottomLeftRadius: groupEnd ? 18 : 5 };

  return (
    <View
      style={{
        paddingHorizontal: 14,
        marginBottom: groupEnd ? 8 : 2,
        // A tapback chip overhangs the bubble top by 12px; give reacted
        // messages that much extra headroom so the chip never slides under
        // the neighboring bubble (iMessage does the same).
        marginTop: message.reactions.length > 0 ? 12 : 0,
      }}
    >
      {message.replyToPreview !== null && (
        // The quote block anchors to the REPLY's side (a cross-side connector
        // reads as an orphaned squiggle); who's being quoted is carried by the
        // outline color — blue = quoting me, gray = quoting them.
        <View
          style={{
            alignItems: mine ? "flex-end" : "flex-start",
            marginLeft: !mine && isGroupChat ? 34 : 0,
          }}
        >
          <View
            style={[
              styles.quote,
              { borderColor: message.replyToFromMe ? theme.bubbleMine : theme.textSecondary },
            ]}
          >
            <Text
              numberOfLines={2}
              style={{
                fontSize: Type.secondary,
                color: message.replyToFromMe ? theme.bubbleMine : theme.textSecondary,
              }}
            >
              {message.replyToPreview || "Original message"}
            </Text>
          </View>
          <View
            style={[
              styles.replyStem,
              { backgroundColor: theme.textSecondary },
              mine ? { marginRight: 26 } : { marginLeft: 26 },
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
              <PersonAvatar address={message.sender?.address ?? null} name={senderName} size={28} />
            )}
          </View>
        )}

        <View style={{ maxWidth: bubbleMaxWidth, alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}>
          {!mine && isGroupChat && groupStart && senderName !== "" && (
            <Text style={[styles.senderName, { color: theme.textSecondary }]}>{senderName}</Text>
          )}

          {/* Media and link cards render bare — no colored bubble around them. */}
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
                  highlighted && styles.highlighted,
                  highlighted && { borderColor: theme.accent },
                  { backgroundColor: mine ? mineColor : theme.bubbleTheirs },
                  !mine && { borderColor: theme.bubbleTheirsBorder, borderWidth: StyleSheet.hairlineWidth },
                  joined,
                  notDelivered && { backgroundColor: "rgba(255,69,58,0.25)" },
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

            {message.reactions.length > 0 && (
              <View style={[styles.reactionRow, mine ? { left: -10 } : { right: -10 }]}>
                {Object.entries(
                  message.reactions.reduce<Record<string, number>>((acc, r) => {
                    const glyph = r.type === "emoji" ? (r.emoji ?? "🙂") : r.type;
                    acc[glyph] = (acc[glyph] ?? 0) + 1;
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
            <Pressable accessibilityRole="button" accessibilityLabel="Retry sending" onPress={() => onRetry(message)} style={({ hovered, pressed }) => [(hovered || pressed) && { opacity: HOVER_DIM }]}>
              <Text style={[styles.failed, { color: theme.destructive }]}>Not delivered. Select to retry.</Text>
            </Pressable>
          ) : delivery === "uncertain" ? (
            <Text style={[styles.meta, { color: theme.textSecondary }]}>May not have delivered</Text>
          ) : (
            (groupEnd || message.edited || showTime) && (
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {message.edited ? "Edited · " : ""}
                {groupEnd || showTime ? formatBubbleTime(message.dateCreated) : ""}
                {mine && isLatestOutgoing
                  ? message.pending
                    ? slowSend ? " · Sending…" : ""
                    : message.dateRead
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
    // borderColor comes from theme.accent inline at the call site — this only
    // fixes the width; the old hardcoded #0A84FF always rendered dark-mode blue.
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  quote: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "70%",
  },
  replyStem: {
    borderRadius: 1,
    height: 8,
    marginBottom: 1,
    marginTop: 1,
    opacity: 0.55,
    width: 2,
  },
  senderName: {
    fontSize: Type.caption,
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
    borderRadius: Radii.chip,
    paddingHorizontal: 5,
    paddingVertical: 2,
    ...CardShadow,
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  meta: {
    fontSize: Type.caption,
    marginTop: 2,
    marginHorizontal: 4,
  },
  failed: {
    // color comes from theme.destructive inline at the call site.
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
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
  attachmentLink: {
    // color comes from theme.accent inline at the call site.
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
