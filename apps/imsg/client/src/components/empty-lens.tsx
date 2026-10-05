import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { compactAge, LATE_AFTER_MS, waitingLongest, yourTurnLongest, type AgedChat } from "@/lib/turn-age";

import { ChatAvatar } from "./avatar";

export type EmptyLensKind = "unresponded" | "unread";

export interface EmptyLensCounts {
  readonly unresponded: number;
  readonly repliedToday?: number;
  readonly settledToday?: number;
}

export interface EmptyLensProps {
  readonly lens: EmptyLensKind;
  readonly chats: readonly ChatSummary[];
  readonly counts: EmptyLensCounts;
  readonly now: number;
  readonly onOpenChat: (chat: ChatSummary, opts: { focusComposer: true }) => void;
  readonly onSeeAllWaiting: () => void;
  readonly onGoToNeedsReply: () => void;
}

export interface EmptyLensCopy {
  readonly title: string;
  readonly line2: string;
  readonly sectionTitle: string;
  readonly footer: string;
  /** Desktop-only shortcut hint after the footer link. */
  readonly footerHint?: string;
}

const ROWS = 3;

const LENSES = {
  unresponded: {
    title: "You've replied to everyone",
    line2: (counts: EmptyLensCounts) => {
      const today = [
        counts.repliedToday === undefined ? null : `${counts.repliedToday} replied`,
        counts.settledToday === undefined ? null : `${counts.settledToday} settled`,
      ].filter((part) => part !== null);
      return `New messages show up here as they arrive.${today.length ? ` ${today.join(" and ")} today.` : ""}`;
    },
    sectionTitle: "Waiting on them the longest",
    pick: waitingLongest,
    total: (chats: readonly ChatSummary[]) => chats.filter((chat) => chat.flags.waiting).length,
    rowTrailing: "nudge",
    footer: "See all in Waiting",
    footerHint: undefined,
    footerAction: "onSeeAllWaiting",
  },
  unread: {
    title: "Nothing unread",
    line2: ({ unresponded }: EmptyLensCounts) =>
      `You've opened every message.${unresponded === 0 ? "" : unresponded === 1 ? " 1 conversation still needs a reply." : ` ${unresponded} conversations still need a reply.`}`,
    sectionTitle: "Your turn the longest",
    pick: yourTurnLongest,
    total: (_chats: readonly ChatSummary[], counts: EmptyLensCounts) => counts.unresponded,
    rowTrailing: "age",
    footer: "Go to Needs reply",
    footerHint: "⌘1",
    footerAction: "onGoToNeedsReply",
  },
} as const satisfies Record<EmptyLensKind, {
  title: string;
  line2: (counts: EmptyLensCounts) => string;
  sectionTitle: string;
  pick: (chats: readonly ChatSummary[], limit: number, now: number) => AgedChat[];
  total: (chats: readonly ChatSummary[], counts: EmptyLensCounts) => number;
  rowTrailing: "nudge" | "age";
  footer: string;
  footerHint: string | undefined;
  footerAction: "onSeeAllWaiting" | "onGoToNeedsReply";
}>;

export function emptyLensCopy(lens: EmptyLensKind, counts: EmptyLensCounts): EmptyLensCopy {
  const entry = LENSES[lens];
  return { title: entry.title, line2: entry.line2(counts), sectionTitle: entry.sectionTitle, footer: entry.footer, footerHint: entry.footerHint };
}

// Desktop values from round4/html/desk-empty.html, phone from phone-empty.html.
const SIZE = {
  desk: { padTop: 22, padX: 8, headPadX: 10, titleSize: 13, icon: 17, iconGap: 8, line2Size: 12.5, line2Lh: 17.5, line2Indent: 22, groupTop: 22, groupSize: 11.5, rowsPadX: 0, avatar: 32, rowPadX: 10, rowPadTop: 9, rowPadBottom: 10, rowGap: 10, rowRadius: 10, name: 13, nameLh: 18, snippet: 12.5, snippetLh: 17, age: 12, nudgeH: 24, nudgePadX: 9, nudgeRadius: 7, nudgeSize: 12, nudgeBorder: true, more: 12.5, morePadX: 10, showAgeWithNudge: true },
  phone: { padTop: 20, padX: 0, headPadX: 20, titleSize: 16, icon: 20, iconGap: 9, line2Size: 15, line2Lh: 20.7, line2Indent: 29, groupTop: 16, groupSize: 13, rowsPadX: 8, avatar: 42, rowPadX: 12, rowPadTop: 10, rowPadBottom: 11, rowGap: 12, rowRadius: 14, name: 16, nameLh: 21, snippet: 15, snippetLh: 20, age: 14, nudgeH: 30, nudgePadX: 12, nudgeRadius: 999, nudgeSize: 14, nudgeBorder: false, more: 15, morePadX: 20, showAgeWithNudge: false },
} as const;

function snippetOf(chat: ChatSummary): string {
  const last = chat.lastMessage;
  if (!last) return "";
  return `${last.isFromMe ? "You: " : ""}${last.text || (last.hasAttachments ? "Attachment" : "")}`;
}

/** The calm state a Needs reply or Unread lens shows once it is empty: what happened, then the next useful step. */
export function EmptyLens(props: EmptyLensProps) {
  const { lens, chats, counts, now, onOpenChat } = props;
  const { wide } = useLayoutMode();
  const c = useTheme();
  const s = wide ? SIZE.desk : SIZE.phone;
  const entry = LENSES[lens];
  const copy = emptyLensCopy(lens, counts);
  const rows = entry.pick(chats, ROWS, now);

  return (
    <View style={{ paddingTop: s.padTop, paddingHorizontal: s.padX }}>
      <View style={{ paddingHorizontal: s.headPadX }}>
        <View style={[styles.line1, { gap: s.iconGap }]}>
          <Ionicons name="checkmark-circle-outline" size={s.icon} color={c.icon} />
          <Text role="heading" style={{ color: c.text, fontSize: s.titleSize, fontWeight: "600" }}>{copy.title}</Text>
        </View>
        <Text style={{ color: c.textSecondary, fontSize: s.line2Size, lineHeight: s.line2Lh, marginTop: 4, marginLeft: s.line2Indent }}>{copy.line2}</Text>
      </View>

      {rows.length > 0 && (
        <>
          <View style={[styles.group, { paddingTop: s.groupTop, paddingHorizontal: s.headPadX }]}>
            <Text style={{ color: c.textTertiary, fontSize: s.groupSize }}>{copy.sectionTitle}</Text>
            <Text style={[styles.num, { color: c.textTertiary, fontSize: s.groupSize }]}>{entry.total(chats, counts)}</Text>
          </View>
          <View style={{ paddingHorizontal: s.rowsPadX }}>
            {rows.map(({ chat, ageMs }) => {
              const nudge = entry.rowTrailing === "nudge";
              const late = !nudge && ageMs > LATE_AFTER_MS;
              const age = (
                <Text style={[styles.num, { color: late ? c.turn : c.textTertiary, fontSize: s.age, lineHeight: s.nameLh, fontWeight: late ? "600" : "400" }]}>
                  {compactAge(ageMs)}
                </Text>
              );
              return (
                <Pressable
                  key={chat.guid}
                  accessibilityRole="button"
                  accessibilityLabel={chat.displayName}
                  onPress={() => onOpenChat(chat, { focusComposer: true })}
                  style={({ hovered, pressed }) => [
                    styles.row,
                    { gap: s.rowGap, paddingHorizontal: s.rowPadX, paddingTop: s.rowPadTop, paddingBottom: s.rowPadBottom, borderRadius: s.rowRadius, alignItems: nudge ? "center" : "flex-start" },
                    (hovered || pressed) && { backgroundColor: c.rowHover },
                  ]}
                >
                  <ChatAvatar chat={chat} size={s.avatar} />
                  <View style={styles.body}>
                    <Text numberOfLines={1} style={{ color: c.text, fontSize: s.name, lineHeight: s.nameLh, fontWeight: "600" }}>{chat.displayName}</Text>
                    <Text numberOfLines={1} style={{ color: c.textSecondary, fontSize: s.snippet, lineHeight: s.snippetLh, marginTop: 1 }}>{snippetOf(chat)}</Text>
                  </View>
                  {nudge ? (
                    <View style={styles.trailing}>
                      {s.showAgeWithNudge && age}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Nudge ${chat.displayName}`}
                        onPress={(event) => {
                          event.stopPropagation();
                          onOpenChat(chat, { focusComposer: true });
                        }}
                        style={({ hovered, pressed }) => [
                          styles.nudge,
                          { height: s.nudgeH, paddingHorizontal: s.nudgePadX, borderRadius: s.nudgeRadius },
                          s.nudgeBorder
                            ? { backgroundColor: hovered || pressed ? c.field : c.surface, borderWidth: 1, borderColor: c.dividerStrong }
                            : { backgroundColor: hovered || pressed ? c.dividerStrong : c.field },
                        ]}
                      >
                        <Text style={{ color: c.text, fontSize: s.nudgeSize, fontWeight: "600" }}>Nudge</Text>
                      </Pressable>
                    </View>
                  ) : age}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={copy.footer}
        onPress={props[entry.footerAction]}
        style={({ hovered }) => [styles.more, { paddingHorizontal: s.morePadX, paddingVertical: wide ? 6 : 8 }, hovered && { opacity: 0.75 }]}
      >
        <Text style={{ color: c.textSecondary, fontSize: s.more, fontWeight: "600" }}>{copy.footer}</Text>
        {wide && copy.footerHint && (
          <Text style={[styles.num, { color: c.textTertiary, fontSize: 11, fontWeight: "500", marginLeft: 8 }]}>{copy.footerHint}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line1: { alignItems: "center", flexDirection: "row" },
  group: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 6 },
  num: { fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", marginBottom: 4 },
  body: { flex: 1, minWidth: 0 },
  trailing: { alignItems: "flex-end", gap: 5 },
  nudge: { alignItems: "center", justifyContent: "center" },
  more: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row" },
});
