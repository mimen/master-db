import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { memo, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { useChatActions } from "@/hooks/use-chat-actions";
import { laterOptions, useRowDraft } from "@/hooks/use-triage-actions";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { useType } from "@/hooks/use-type";
import { Colors, Type } from "@/constants/theme";
import { archiveChat, markChatRead, markChatUnread } from "@/lib/chat-actions";
import { formatListTimestamp } from "@/lib/format";
import {
  ROW_SIGNAL_SIZE,
  RowSignalColor,
  rowSignal,
  unreadLabel,
} from "@/lib/row-signal";
import { hapticCommit } from "@/lib/haptics";
import { fillComposer } from "@/lib/composer-fill";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { useWebContextMenu } from "@/lib/use-web-context-menu";

import { ChatAvatar } from "./avatar";
import { HoverFillButton } from "./hover-fill-button";
import { FAVORITE_GOLD } from "./person-crm-section";

const ACTION_WIDTH = 84;

function RowSignal({ chat }: { readonly chat: ChatSummary }): React.JSX.Element {
  const kind = rowSignal(chat);
  return (
    <View
      accessibilityElementsHidden={kind === null}
      accessibilityLabel={
        kind === "unread"
          ? `${unreadLabel(chat.unreadCount)} unread`
          : kind === "unresponded"
            ? "Unresponded"
            : kind === "archived"
              ? "Archived"
              : undefined
      }
      style={[
        styles.signal,
        kind === "unread" && { backgroundColor: RowSignalColor.unread },
        kind === "unresponded" && { backgroundColor: RowSignalColor.unresponded },
        kind === "archived" && { backgroundColor: RowSignalColor.archived },
      ]}
    >
      {kind === "unread" ? (
        <Text style={styles.signalCount}>{unreadLabel(chat.unreadCount)}</Text>
      ) : kind === "unresponded" ? (
        <Ionicons name="arrow-undo-outline" size={11} color={RowSignalColor.unrespondedGlyph} />
      ) : kind === "archived" ? (
        <Ionicons name="archive-outline" size={11} color={RowSignalColor.onFill} />
      ) : null}
    </View>
  );
}

/**
 * iMessage/Mail-style action pane: the colored panel tracks the finger (its
 * width follows the drag), and the icon pops as you approach the commit
 * threshold — so a decisive full swipe commits, a hesitant one springs back.
 */
function SwipeAction({
  translation,
  icon,
  label,
  color,
  side,
  commit,
}: {
  translation: SharedValue<number>;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  side: "left" | "right";
  commit: number;
}) {
  const theme = useTheme();
  const containerStyle = useAnimatedStyle(() => ({
    width: Math.max(ACTION_WIDTH, Math.abs(translation.value)),
  }));
  // Buzz once as the drag arms the action, not on release — this is the signal
  // that tells you the swipe will commit if you let go now.
  useAnimatedReaction(
    () => Math.abs(translation.value) >= commit,
    (armed, wasArmed) => {
      if (armed && wasArmed === false) runOnJS(hapticCommit)();
    },
  );
  const contentStyle = useAnimatedStyle(() => {
    const dist = Math.abs(translation.value);
    return {
      opacity: interpolate(dist, [10, 42], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(dist, [commit - 26, commit], [1, 1.18], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Reanimated.View
      style={[
        styles.swipeAction,
        { backgroundColor: color, alignItems: side === "left" ? "flex-start" : "flex-end" },
        containerStyle,
      ]}
    >
      <Reanimated.View style={[styles.swipeActionInner, contentStyle]}>
        <Ionicons name={icon} size={23} color={theme.onAccent} />
        <Text style={styles.swipeActionLabel}>{label}</Text>
      </Reanimated.View>
    </Reanimated.View>
  );
}

function ChatRowInner({
  chat,
  selected,
  keyboardFocused = false,
  onPress,
  onDone,
  onLater,
}: {
  chat: ChatSummary;
  selected: boolean;
  /** Glide-mode cursor: accent edge on the selected row while navigating. */
  keyboardFocused?: boolean;
  onPress: () => void;
  onDone?: () => void;
  onLater?: (until: number) => void;
}) {
  const theme = useTheme();
  const visual = useTriageTheme();
  const type = useType();
  const { openMenu } = useChatActions();
  const showSheet = useActionSheet();
  const { width: winW, wide: compact } = useLayoutMode();
  const [hovered, setHovered] = useState(false);
  const waitingOnly = chat.flags.waiting && !chat.flags.unresponded;
  const rowDraftState = useRowDraft(
    chat.guid,
    compact && (chat.flags.unresponded || chat.flags.waiting),
  );
  const rowDraft = rowDraftState.draft;
  // The third lane shows row state until selection reveals its actions. The
  // message preview above it remains stable throughout the transition.
  const actionsVisible = compact && selected;
  const swipeRef = useRef<SwipeableMethods>(null);
  const last = chat.lastMessage;
  const snippet = last
    ? `${last.isFromMe ? "You: " : chat.isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : ""}${
        last.text || (last.hasAttachments ? "Attachment" : "")
      }`
    : "";

  const contextRef = useWebContextMenu<typeof Pressable>((anchor) => openMenu(chat, anchor));

  // Hover via DOM mouseenter/mouseleave: unlike RNW's hover events these do
  // not fire when the pointer moves onto a child (the archive button).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = contextRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const enter = () => {
      setHovered(true);
      prefetchThread(chat.guid);
    };
    const leave = () => setHovered(false);
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    return () => {
      node.removeEventListener("mouseenter", enter);
      node.removeEventListener("mouseleave", leave);
    };
  }, [chat.guid, contextRef]);

  // Commit distance scales with row width so it's a deliberate full swipe on a
  // phone, not a hair-trigger. Capped so a tablet/desktop doesn't need a marathon.
  // Overshoot stays ON: disabling it collapses the Swipeable's interpolation to a
  // zero slope past the pane width, which clamped travel at ACTION_WIDTH while
  // commit still measured the raw finger — a dead zone the icon pop never reached.
  const commit = Math.min(190, Math.max(120, winW * 0.42));

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      containerStyle={compact ? styles.desktopCardWrap : undefined}
      friction={1}
      leftThreshold={commit}
      rightThreshold={commit}
      renderLeftActions={(_progress, translation) => (
        <SwipeAction
          translation={translation}
          icon={chat.flags.unread ? "mail-open-outline" : "mail-unread-outline"}
          label={chat.flags.unread ? "Read" : "Unread"}
          color={theme.accent}
          side="left"
          commit={commit}
        />
      )}
      renderRightActions={(_progress, translation) => (
        <SwipeAction
          translation={translation}
          icon={chat.flags.archived ? "arrow-undo-outline" : "archive-outline"}
          label={chat.flags.archived ? "Unarchive" : "Archive"}
          color="#F0A500"
          side="right"
          commit={commit}
        />
      )}
      onSwipeableOpen={(direction) => {
        // `direction` is the swipe direction, not the pane side: swiping LEFT
        // reveals the right-hand (Archive) pane, swiping RIGHT reveals the
        // left-hand (Read/Unread) pane. Fire the optimistic action then close.
        if (direction === "left") {
          archiveChat(chat, !chat.flags.archived);
        } else {
          if (chat.flags.unread) markChatRead(chat);
          else markChatUnread(chat);
        }
        swipeRef.current?.close();
      }}
    >
      <Pressable
        testID="conversation-row"
        ref={contextRef as never}
        onPress={onPress}
        onPressIn={() => prefetchThread(chat.guid)}
        onLongPress={() => openMenu(chat)}
        style={({ pressed }) => [
          styles.row,
          compact && styles.desktopCard,
          { height: compact ? 82 : undefined, minHeight: compact ? 82 : 92 },
          compact
            ? ({
                backgroundColor: selected ? visual.cardSelected : hovered || pressed ? visual.cardHover : visual.card,
                boxShadow: `0 1px 3px ${visual.cardShadow}`,
              } as object)
            : {
                backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : theme.background,
              },
        ]}
      >
        {/* Glide cursor — absolutely positioned so it never shifts layout. */}
        {keyboardFocused && (
          <View style={[styles.glideCursor, { backgroundColor: theme.accent }]} />
        )}
        <ChatAvatar chat={chat} size={compact ? 40 : 52} />
        {/* Messages-style hairline: starts after the avatar, not under it. */}
        <View
          style={[
            styles.separator,
            {
              backgroundColor: theme.divider,
              left: 16 + (compact ? 40 : 52) + 11,
              opacity: compact ? 0 : 1,
            },
          ]}
        />
        <View style={styles.content}>
          <View style={styles.topLine}>
            <Text numberOfLines={1} style={[styles.name, { color: compact ? visual.text : theme.text, fontSize: compact ? 13 : type.title, fontWeight: chat.flags.unread ? "700" : "600" }]}>
              {chat.displayName}
            </Text>
            {/* Private CRM layer (favorite/priority) — mirrors the star shown
                on favorited rows in contacts-list-pane.tsx. Priority is kept
                subtle: only P1/P2 (the top two of five levels) get a dot, so
                the row doesn't turn into a dashboard. */}
            {chat.crm?.is_favorite && (
              <Ionicons
                name="star"
                size={13}
                color={FAVORITE_GOLD}
                accessibilityLabel="Favorite"
                style={styles.favoriteStar}
              />
            )}
            {last && (
              <Text style={[styles.time, { color: compact ? visual.muted : theme.textSecondary, fontSize: compact ? 11 : type.secondary }]}>
                {formatListTimestamp(last.dateCreated)}
              </Text>
            )}
          </View>
          <View style={styles.messageRow}>
            <Text numberOfLines={1} style={[styles.messagePreview, { color: compact ? visual.snippet : theme.textSecondary, fontSize: compact ? 12 : 14, lineHeight: compact ? 15 : 18, fontWeight: chat.flags.unread ? "500" : "400" }]}>{snippet}</Text>
            {!compact ? <RowSignal chat={chat} /> : null}
          </View>
          {compact ? <View style={styles.previewLine}>
            <View
              pointerEvents="none"
              style={[styles.previewLayer, { justifyContent: "flex-end", opacity: actionsVisible ? 0 : 1 }, Platform.OS === "web" ? [styles.opacityTransition, { visibility: actionsVisible ? "hidden" : "visible", transitionDelay: actionsVisible ? "0ms,60ms" : "60ms,0ms" } as object] : null]}
            >
              <RowSignal chat={chat} />
            </View>
            <View
              pointerEvents={actionsVisible ? "auto" : "none"}
              style={[styles.actionLayer, { opacity: actionsVisible ? 1 : 0 }, Platform.OS === "web" ? [styles.opacityTransition, { visibility: actionsVisible ? "visible" : "hidden", transitionDelay: actionsVisible ? "60ms,0ms" : "0ms,60ms" } as object] : null]}
            >
              {waitingOnly ? (
                <>
                  <HoverFillButton accessibilityLabel="Nudge this conversation" onPress={(event) => { event.stopPropagation(); onPress(); if (rowDraft) requestAnimationFrame(() => fillComposer(rowDraft)); }} restFill={theme.accent} hoverFill="#0066D6" style={styles.inlineAction}><Ionicons name="arrow-undo-outline" size={13} color={theme.onAccent} /><Text style={[styles.inlineActionText, { color: theme.onAccent }]}>Nudge</Text></HoverFillButton>
                  <HoverFillButton accessibilityLabel="Stop waiting on this conversation" onPress={(event) => { event.stopPropagation(); onDone?.(); }} restFill={visual.controlFill} hoverFill={visual.controlFillHover} style={styles.inlineAction}><Ionicons name="checkmark" size={13} color={theme.accent} /><Text style={[styles.inlineActionText, { color: visual.text }]}>Let go</Text></HoverFillButton>
                </>
              ) : (
                <>
                  <HoverFillButton accessibilityLabel="Reply to conversation" onPress={(event) => { event.stopPropagation(); onPress(); if (rowDraft) requestAnimationFrame(() => fillComposer(rowDraft)); }} restFill={theme.accent} hoverFill="#0066D6" style={styles.inlineAction}><Ionicons name="arrow-undo-outline" size={13} color={theme.onAccent} /><Text style={[styles.inlineActionText, { color: theme.onAccent }]}>Reply</Text></HoverFillButton>
                  <HoverFillButton accessibilityLabel="Mark conversation done" onPress={(event) => { event.stopPropagation(); onDone?.(); }} restFill={visual.controlFill} hoverFill={visual.controlFillHover} style={styles.inlineAction}><Ionicons name="checkmark" size={13} color={theme.accent} /><Text style={[styles.inlineActionText, { color: visual.text }]}>Done</Text></HoverFillButton>
                  <HoverFillButton accessibilityLabel="Move conversation to Later" onPress={(event) => { event.stopPropagation(); showSheet({ title: "Later", anchor: pressAnchor(event), actions: laterOptions().map((option) => ({ label: option.label, onPress: () => onLater?.(option.until) })) }); }} restFill={visual.controlFill} hoverFill={visual.controlFillHover} style={styles.inlineAction}><Ionicons name="time-outline" size={13} color={visual.muted} /><Text style={[styles.inlineActionText, { color: visual.text }]}>Later</Text></HoverFillButton>
                </>
              )}
              <Pressable accessibilityLabel="More conversation actions" onPress={(event) => { event.stopPropagation(); openMenu(chat); }} style={styles.moreAction}><Ionicons name="ellipsis-horizontal" size={15} color={visual.muted} /></Pressable>
            </View>
          </View> : null}
        </View>
        {!compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chat.flags.archived ? "Unarchive conversation" : "Archive conversation"}
            onPress={(e) => {
              e.stopPropagation();
              archiveChat(chat, !chat.flags.archived);
            }}
            hitSlop={6}
            pointerEvents={hovered ? "auto" : "none"}
            style={[
              styles.hoverArchive,
              { backgroundColor: theme.backgroundSelected, opacity: hovered ? 1 : 0 },
            ]}
          >
            <Ionicons
              name={chat.flags.archived ? "arrow-undo-outline" : "archive-outline"}
              size={15}
              color={theme.text}
            />
          </Pressable>
        )}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

/**
 * Plain shallow memo. This only pays off because chat-store reconciles object
 * identity on refetch — without that every row would see a "new" chat each
 * poll. Deliberately not a hand-listed field comparator: that silently rots
 * the moment ChatSummary grows a field.
 */
export const ChatRow = memo(ChatRowInner);

const styles = StyleSheet.create({
  desktopCardWrap: {
    borderRadius: 11,
    marginBottom: 6,
    overflow: "visible",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 80,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
  },
  desktopCard: {
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  separator: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    position: "absolute",
    right: 0,
  },
  glideCursor: {
    borderRadius: 2,
    bottom: 8,
    left: 0,
    position: "absolute",
    top: 8,
    width: 3,
  },
  content: {
    flex: 1,
    marginLeft: 11,
    minWidth: 0,
    paddingVertical: 2,
  },
  topLine: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 17,
    letterSpacing: -0.2,
    minWidth: 0,
  },
  time: {
    flexShrink: 0,
    fontSize: 13,
  },
  favoriteStar: {
    flexShrink: 0,
  },
  messageRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 1,
  },
  messagePreview: {
    flex: 1,
    minWidth: 0,
  },
  previewLine: {
    height: 24,
    marginTop: 3,
    position: "relative",
  },
  previewLayer: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    gap: 7,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  actionLayer: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    gap: 5,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  // Web-only CSS transition properties — cast like desktop-split.tsx's
  // backdrop-filter escape; RN-web passes them through, TS can't see them.
  opacityTransition: Platform.OS === "web"
    ? ({
        transitionDuration: "60ms, 0ms",
        transitionProperty: "opacity, visibility",
        transitionTimingFunction: "cubic-bezier(0.2,0,0,1)",
      } as object)
    : {},
  inlineActions: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 5,
  },
  inlineAction: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 3,
    height: 24,
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  inlineActionText: {
    fontSize: 11,
    fontWeight: "600",
  },
  moreAction: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  signal: {
    alignItems: "center",
    borderRadius: ROW_SIGNAL_SIZE / 2,
    flexShrink: 0,
    height: ROW_SIGNAL_SIZE,
    justifyContent: "center",
    width: ROW_SIGNAL_SIZE,
  },
  signalCount: {
    color: RowSignalColor.onFill,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  hoverArchive: {
    alignItems: "center",
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    marginTop: -14,
    position: "absolute",
    right: 10,
    top: "50%",
    width: 28,
    zIndex: 2,
  },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
  },
  swipeActionInner: {
    alignItems: "center",
    gap: 3,
    width: ACTION_WIDTH,
  },
  swipeActionLabel: {
    color: Colors.light.onAccent,
    fontSize: Type.secondary,
    fontWeight: "600",
  },
});
