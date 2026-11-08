import { support } from "@shared/platform-profile";
import type { ConversationId } from "@shared/types";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useGlobalSearchParams } from "expo-router";
import { createElement, useEffect, useMemo, useState, type JSX } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { DesktopSplit } from "@/components/desktop-split";
import { PHONE_TAB_BAR_CLEARANCE } from "@/components/phone-tab-bar";
import { SidebarChrome } from "@/components/sidebar/sidebar-chrome";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import { SidebarFrame } from "@/components/sidebar/sidebar-frame";
import { SidebarHeader } from "@/components/sidebar/sidebar-header";
import { TriageGeometry } from "@/constants/triage-theme";
import { useTheme } from "@/hooks/use-theme";
import { commaApi } from "@/lib/convex-api";
import { formatListTimestamp, formatReceiptTime } from "@/lib/format";
import { headerFace } from "@/lib/header-font";
import { EMAIL_SANDBOX, emailDocument, inLens, type MailLens } from "@/lib/mail";
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";

/**
 * The Mail workspace: a mailbox's inbox threads under two lenses, and a reader that shows each message as a card.
 * Gmail is read-only until G2, so the reader's reply bar says why it can't send.
 */

type Thread = FunctionReturnType<typeof commaApi.listEmailThreads>["page"][number];
type Email = FunctionReturnType<typeof commaApi.listMessages>["page"][number];

const READ_ONLY = support({ platform: "gmail", service: "Gmail", isGroup: true }, "reply");
const LENSES: readonly { id: MailLens; label: string }[] = [{ id: "people", label: "People" }, { id: "all", label: "All inbox" }];

export function MailWorkspace({ wide }: { readonly wide: boolean }): JSX.Element {
  const theme = useTheme();
  const { isAuthenticated } = useConvexAuth();
  const [lens, setLens] = useState<MailLens>("people");
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null);
  // Search opens a mail hit as /mail?thread=<id>.
  const { thread: routed } = useGlobalSearchParams<{ thread?: string }>();
  useEffect(() => {
    if (routed) setSelectedId(routed as ConversationId);
  }, [routed]);
  const { results, status, loadMore } = usePaginatedQuery(commaApi.listEmailThreads, isAuthenticated ? {} : "skip", { initialNumItems: 50 });
  const rows = useMemo(() => results.filter((row) => inLens(row, lens)), [results, lens]);
  const more = results.length - rows.length;

  const lensBar = (
    <View role="tablist" style={styles.lenses}>
      {LENSES.map((option) => {
        const on = option.id === lens;
        const count = results.filter((row) => inLens(row, option.id)).length;
        return (
          <Pressable
            key={option.id}
            role="tab"
            aria-selected={on}
            accessibilityLabel={`${option.label}, ${count}`}
            onPress={() => setLens(option.id)}
            style={({ hovered }: { hovered?: boolean }) => [styles.lens, { backgroundColor: on ? theme.rowSelected : hovered ? theme.rowHover : "transparent" }]}
          >
            <Text style={[styles.lensText, { color: on ? theme.text : theme.textSecondary }]}>{option.label}</Text>
            <Text style={[styles.lensCount, { color: theme.textTertiary }]}>{count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const heading = (
    <View>
      <Text accessibilityRole="header" style={[styles.headingTitle, { color: theme.text }]}>Mail</Text>
      {lensBar}
    </View>
  );

  const list = (
    <SidebarFrame
      chrome={wide ? <SidebarHeader testID="mail-desk-header" search={<View style={styles.fill} />} actions={null} below={heading} /> : <SidebarChrome actions={null} />}
      footer={wide ? <SidebarFooter workspace="mail" /> : null}
    >
      {status === "LoadingFirstPage" ? <ActivityIndicator style={styles.loading} /> : (
        <FlatList
          testID="mail-list"
          data={rows}
          keyExtractor={(row) => row._id}
          renderItem={({ item }) => <ThreadRow thread={item} selected={wide && selectedId === item._id} onPress={() => setSelectedId(item._id as ConversationId)} />}
          ListHeaderComponent={wide ? null : (
            <View style={{ paddingTop: SIDEBAR_TITLE_HEIGHT }}>
              <Text accessibilityRole="header" style={[styles.phoneTitle, { color: theme.text }]}>Mail</Text>
              {lensBar}
            </View>
          )}
          ListFooterComponent={lens === "people" && more > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setLens("all")} style={styles.more}>
              <Text style={[styles.moreText, { color: theme.textSecondary }]}>{more} more in All inbox</Text>
            </Pressable>
          ) : null}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.textTertiary }]}>
              {lens === "people" ? "No one is waiting on a reply." : "The inbox is empty."}
            </Text>
          }
          onEndReached={() => status === "CanLoadMore" && loadMore(50)}
          contentContainerStyle={wide ? styles.listContent : styles.listContentPhone}
        />
      )}
    </SidebarFrame>
  );

  const reader = selectedId ? (
    <EmailReader
      key={selectedId}
      conversationId={selectedId}
      subject={results.find((row) => row._id === selectedId)?.gmail?.subject}
      onBack={wide ? undefined : () => setSelectedId(null)}
    />
  ) : (
    <View style={[styles.fill, styles.center, { backgroundColor: theme.thread }]}>
      <Text style={{ color: theme.textTertiary, fontSize: 13 }}>Select a thread</Text>
    </View>
  );

  if (!wide) return <View style={[styles.fill, { backgroundColor: theme.background }]}>{selectedId ? reader : list}</View>;
  return <DesktopSplit list={list} detail={reader} />;
}

function ThreadRow({ thread, selected, onPress }: { thread: Thread; selected: boolean; onPress: () => void }): JSX.Element {
  const theme = useTheme();
  const snippet = (thread.lastMessage?.text ?? "").replace(/\s+/g, " ").trim();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${thread.displayName}, ${thread.gmail?.subject ?? ""}`}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [styles.row, { backgroundColor: selected ? theme.rowSelected : hovered ? theme.rowHover : "transparent" }]}
    >
      <View style={styles.rowTop}>
        <Text numberOfLines={1} style={[styles.sender, { color: theme.text }]}>{thread.displayName}</Text>
        <Text style={[styles.time, { color: theme.textTertiary }]}>{formatListTimestamp(thread.lastMessageAt)}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.subject, { color: theme.text }]}>{thread.gmail?.subject}</Text>
      <Text numberOfLines={2} style={[styles.snippet, { color: theme.textSecondary }]}>{snippet}</Text>
    </Pressable>
  );
}

/** `subject` is the listed row's; a thread opened from search, archived or not yet listed, reads it off its messages. */
function EmailReader({ conversationId, subject, onBack }: { conversationId: ConversationId; subject?: string; onBack?: () => void }): JSX.Element {
  const theme = useTheme();
  const { results, status, loadMore } = usePaginatedQuery(commaApi.listMessages, { conversationId }, { initialNumItems: 25 });
  const messages = useMemo(() => [...results].sort((a, b) => a.dateCreated - b.dateCreated), [results]);
  return (
    <View testID="email-reader" style={[styles.fill, { backgroundColor: theme.thread }]}>
      <View style={[styles.readerHeader, { borderBottomColor: theme.divider }]}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Mail" onPress={onBack} hitSlop={8}>
            <Text style={[styles.back, { color: theme.accent }]}>Mail</Text>
          </Pressable>
        ) : null}
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.readerSubject, { color: theme.text }]}>{subject ?? messages[0]?.subject ?? ""}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.cards}>
        {status === "CanLoadMore" ? (
          <Pressable accessibilityRole="button" onPress={() => loadMore(25)} style={styles.more}>
            <Text style={[styles.moreText, { color: theme.textSecondary }]}>Earlier messages</Text>
          </Pressable>
        ) : null}
        {status === "LoadingFirstPage" ? <ActivityIndicator style={styles.loading} /> : messages.map((message) => <EmailCard key={message._id} message={message} />)}
      </ScrollView>
      <View style={[styles.replyBar, onBack && { paddingBottom: PHONE_TAB_BAR_CLEARANCE }, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
        <Text style={[styles.replyText, { color: theme.textTertiary }]}>{READ_ONLY?.ok === false ? READ_ONLY.reason : ""}</Text>
      </View>
    </View>
  );
}

const names = (addresses: readonly { address: string; name: string | null }[]) => addresses.map((a) => a.name ?? a.address).join(", ");

function EmailCard({ message }: { message: Email }): JSX.Element {
  const theme = useTheme();
  const [images, setImages] = useState(false);
  const from = message.gmail?.from ?? message.sender ?? { address: "", name: null };
  const name = message.isFromMe ? "You" : message.sender?.name ?? from.name ?? from.address;
  const html = message.gmail?.html;
  const blocked = message.gmail?.blockedImages ?? 0;
  return (
    <View testID="email-card" style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.divider }]}>
      <View style={styles.cardHead}>
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[styles.from, { color: theme.text }]}>
            {name}{name !== from.address ? <Text style={{ color: theme.textTertiary }}>{`  ${from.address}`}</Text> : null}
          </Text>
          {message.gmail?.to.length ? (
            <Text numberOfLines={1} style={[styles.to, { color: theme.textTertiary }]}>
              To {names(message.gmail.to)}{message.gmail.cc.length ? `, cc ${names(message.gmail.cc)}` : ""}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.time, { color: theme.textTertiary }]}>{formatReceiptTime(message.dateCreated)}</Text>
      </View>
      {html !== undefined && Platform.OS === "web" ? (
        <>
          {blocked > 0 && !images ? (
            <Pressable accessibilityRole="button" onPress={() => setImages(true)} style={[styles.loadImages, { borderColor: theme.divider }]}>
              <Text style={[styles.loadImagesText, { color: theme.accent }]}>Load images</Text>
              <Text style={[styles.loadImagesNote, { color: theme.textTertiary }]}>{blocked === 1 ? "1 remote image is blocked" : `${blocked} remote images are blocked`}</Text>
            </Pressable>
          ) : null}
          <EmailFrame html={html} images={images} title={`Email from ${name}`} />
        </>
      ) : (
        // ponytail: phones show the plain text; a JavaScript-off WebView for the HTML needs react-native-webview in an EAS build.
        <Text selectable style={[styles.plain, { color: theme.text }]}>{message.text}</Text>
      )}
    </View>
  );
}

/** The cleaned HTML in a sandboxed iframe that runs no scripts, sized to its content once it loads. */
function EmailFrame({ html, images, title }: { html: string; images: boolean; title: string }): JSX.Element {
  const [height, setHeight] = useState(120);
  return createElement("iframe", {
    title,
    srcDoc: emailDocument(html, { images }),
    sandbox: EMAIL_SANDBOX,
    referrerPolicy: "no-referrer",
    style: { border: 0, width: "100%", height, background: "#fff", borderRadius: 8 },
    onLoad: (event: { currentTarget: HTMLIFrameElement }) => {
      const body = event.currentTarget.contentDocument?.documentElement;
      if (body) setHeight(body.scrollHeight + 4);
    },
  });
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  loading: { paddingTop: 36 },
  headingTitle: { ...headerFace, fontSize: 15, letterSpacing: -0.15, paddingBottom: 8 },
  phoneTitle: { ...headerFace, fontSize: 26, letterSpacing: -0.5, paddingBottom: 12, paddingTop: 4 },
  lenses: { flexDirection: "row", gap: 4, paddingBottom: 10 },
  lens: { alignItems: "center", borderRadius: 7, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 5 },
  lensText: { fontSize: 13, fontWeight: "600" },
  lensCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  listContent: { paddingBottom: 12, paddingHorizontal: TriageGeometry.listGutter },
  listContentPhone: { paddingBottom: PHONE_TAB_BAR_CLEARANCE, paddingHorizontal: 16 },
  row: { borderRadius: 10, gap: 2, paddingHorizontal: 12, paddingVertical: 9 },
  rowTop: { alignItems: "baseline", flexDirection: "row", gap: 8 },
  sender: { flex: 1, fontSize: 14, fontWeight: "600" },
  time: { fontSize: 12, fontVariant: ["tabular-nums"] },
  subject: { fontSize: 13.5 },
  snippet: { fontSize: 13, lineHeight: 18 },
  more: { alignItems: "center", paddingVertical: 14 },
  moreText: { fontSize: 13, fontWeight: "600" },
  empty: { fontSize: 13, paddingHorizontal: 12, paddingTop: 24 },
  readerHeader: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 6, paddingHorizontal: 24, paddingVertical: 16 },
  back: { fontSize: 15 },
  readerSubject: { ...headerFace, fontSize: 19, letterSpacing: -0.3 },
  cards: { gap: 12, padding: 20, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  cardHead: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  from: { fontSize: 14, fontWeight: "600" },
  to: { fontSize: 12.5, paddingTop: 2 },
  plain: { fontSize: 14, lineHeight: 21 },
  loadImages: { alignItems: "center", borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  loadImagesText: { fontSize: 13, fontWeight: "600" },
  loadImagesNote: { fontSize: 12.5 },
  replyBar: { alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  replyText: { fontSize: 13 },
});
