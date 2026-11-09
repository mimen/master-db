import type { api } from "@convex-api";
import { PROFILES } from "@shared/platform-profile";
import type { ConversationId } from "@shared/types";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Radius, Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { formatListTimestamp } from "@/lib/format";
import { conversationRoute, selectChat } from "@/lib/selection";

const personSummaries = anyApi.comma.personSummaries as unknown as typeof api.comma.personSummaries;

const TURN = { needsYou: "your turn", waiting: "their turn" } as const;

/**
 * The person behind a one-to-one conversation, across platforms: their written summary when the AI process has built
 * one, and their threads that want Milad or wait on them, each opening where it lives.
 */
export function PersonSummary({ conversationId }: { readonly conversationId: ConversationId }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const header = useQuery(personSummaries.get, { conversationId });
  if (!header) return null;
  const { name, platforms, summary, threads } = header;
  const meta = [platforms.map((platform) => PROFILES[platform].name).join(", "), summary ? `summary ${formatListTimestamp(summary.generatedAt)}` : null]
    .filter(Boolean).join(" · ");
  const open = (id: ConversationId) => {
    if (!selectChat({ conversationId: id })) router.push(conversationRoute(id));
  };
  return (
    <View testID="person-summary" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <Text style={[styles.name, { color: theme.text, fontSize: type.body }]}>{name}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: type.secondary }}>{meta}</Text>
      {summary ? (
        <View style={styles.summary}>
          <Text style={{ color: theme.text, fontSize: type.body, lineHeight: 20 }}>{summary.text}</Text>
          {summary.points.map((point) => <Text key={point} style={{ color: theme.text, fontSize: type.body, lineHeight: 20 }}>{`• ${point}`}</Text>)}
        </View>
      ) : null}
      {threads.map((thread) => {
        const here = thread.conversationId === conversationId;
        return (
          <Pressable
            key={thread.conversationId}
            testID="person-thread"
            accessibilityRole="button"
            accessibilityLabel={`${thread.title}, ${PROFILES[thread.platform].name}, ${here ? "this thread" : TURN[thread.state]}`}
            disabled={here}
            onPress={() => open(thread.conversationId)}
            style={({ hovered }: { hovered?: boolean }) => [styles.thread, { backgroundColor: hovered && !here ? theme.rowHover : theme.background }]}
          >
            <Text numberOfLines={1} style={[styles.threadTitle, { color: theme.text, fontSize: type.secondary }]}>
              {here ? "This thread" : `${thread.title} · ${PROFILES[thread.platform].name}`}
            </Text>
            <Text style={{ color: here ? theme.textTertiary : thread.state === "needsYou" ? theme.accent : theme.textSecondary, fontSize: type.secondary }}>
              {here ? "open here" : TURN[thread.state]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.md, gap: Space.xs, padding: Space.lg },
  name: { fontWeight: "600" },
  summary: { gap: Space.xs, paddingVertical: Space.xs },
  thread: { alignItems: "center", borderRadius: Radius.sm, flexDirection: "row", gap: Space.sm, paddingHorizontal: Space.sm, paddingVertical: Space.xs },
  threadTitle: { flex: 1 },
});
