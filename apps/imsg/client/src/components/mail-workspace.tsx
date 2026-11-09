import type { api as convexApi } from "@convex-api";
import { splitQuote } from "@shared/email-quote";
import { pendingClientKey } from "@shared/pending-send";
import { loadsRemoteImages } from "@shared/platform-profile";
import type { ConversationId } from "@shared/types";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { anyApi, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useGlobalSearchParams } from "expo-router";
import { createElement, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import type { ReplyMode } from "@shared/email-reply";
import { Image } from "expo-image";

import { DesktopSplit } from "@/components/desktop-split";
import { EmailComposer, type ComposerSource, type ComposerStart } from "@/components/email-composer";
import { FileCard } from "@/components/media";
import { PHONE_TAB_BAR_CLEARANCE } from "@/components/phone-tab-bar";
import { SidebarChrome } from "@/components/sidebar/sidebar-chrome";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import { SidebarFrame } from "@/components/sidebar/sidebar-frame";
import { SidebarHeader } from "@/components/sidebar/sidebar-header";
import { TriageGeometry } from "@/constants/triage-theme";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useTheme } from "@/hooks/use-theme";
import { openAgentPane } from "@/lib/agent-pane";
import { conversationState } from "@/lib/conversation-state";
import { commaApi } from "@/lib/convex-api";
import { formatListTimestamp, formatReceiptTime } from "@/lib/format";
import { headerFace } from "@/lib/header-font";
import { openExternalUrl } from "@/lib/external-link";
import { useLightbox } from "@/lib/lightbox";
import { EMAIL_SANDBOX, emailDocument, foldQuotes, messageFiles, openByDefault, regularSenders, threadFiles, type MailFile } from "@/lib/mail";
import { inLens, type MailLens } from "@/lib/mail-lens";
import { setMailSelection } from "@/lib/mail-selection";
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";
import { showToast } from "@/lib/toast";

/**
 * The Mail workspace: inbox threads under two lenses, a reader that shows each message as a card with its files and
 * its own Reply, Reply all and Forward, and New email. With two mailboxes connected, a chip row narrows the lenses to
 * one. The email composer opens below the cards; an agent's draft opens it on its own. A thread opens at its first
 * unread message, or its newest, with the rest folded to one line and quoted history behind "•••".
 */

type Thread = FunctionReturnType<typeof commaApi.listEmailThreads>["page"][number];
type Email = FunctionReturnType<typeof commaApi.listMessages>["page"][number];

const accountsApi = anyApi.comma.accounts as unknown as typeof convexApi.comma.accounts;
const LENSES: readonly { id: MailLens; label: string }[] = [{ id: "people", label: "People" }, { id: "all", label: "All inbox" }];

export function MailWorkspace({ wide }: { readonly wide: boolean }): JSX.Element {
  const theme = useTheme();
  const { isAuthenticated } = useConvexAuth();
  const [lens, setLens] = useState<MailLens>("people");
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const open = (id: ConversationId | null) => {
    setComposingNew(false);
    setSelectedId(id);
  };
  // The wide shell's agent pane follows the open thread.
  useEffect(() => {
    setMailSelection(wide && !composingNew ? selectedId : null);
    return () => setMailSelection(null);
  }, [wide, selectedId, composingNew]);
  // Search opens a mail hit as /mail?thread=<id>.
  const { thread: routed } = useGlobalSearchParams<{ thread?: string }>();
  useEffect(() => {
    if (routed) open(routed as ConversationId);
  }, [routed]);
  const { results, status, loadMore } = usePaginatedQuery(commaApi.listEmailThreads, isAuthenticated ? {} : "skip", { initialNumItems: 50 });
  const accounts = useQuery(accountsApi.listAccounts, isAuthenticated ? {} : "skip");
  const mailboxes = useMemo(() => (accounts ?? []).filter((account) => account.platform === "gmail" && account.connected)
    .sort((a, b) => Number(a.gmailApp === "personal") - Number(b.gmailApp === "personal")), [accounts]);
  const [chosen, setMailbox] = useState<string | null>(null);
  const mailbox = mailboxes.length > 1 && mailboxes.some((account) => account._id === chosen) ? chosen : null;
  // ponytail: narrows the loaded pages on the client; a server-side filter when one mailbox's threads sit pages deep.
  const shown = useMemo(() => mailbox ? results.filter((row) => row.accountId === mailbox) : results, [results, mailbox]);
  const rows = useMemo(() => shown.filter((row) => inLens(row, lens)), [shown, lens]);
  const more = shown.length - rows.length;
  // ponytail: counts the loaded pages only; a per-sender count in Convex if a monthly list keeps reading as irregular.
  const regular = useMemo(() => regularSenders(results), [results]);

  const mailboxBar = mailboxes.length > 1 ? (
    <View role="tablist" accessibilityLabel="Mailbox" style={styles.lenses}>
      {[{ id: null, label: "All" }, ...mailboxes.map((account) => ({ id: account._id as string | null, label: account.gmailApp === "personal" ? "Personal" : "AUF" }))].map((option) => {
        const on = option.id === mailbox;
        return (
          <Pressable
            key={option.id ?? "all"}
            role="tab"
            aria-selected={on}
            accessibilityLabel={option.label}
            onPress={() => setMailbox(option.id)}
            style={({ hovered }: { hovered?: boolean }) => [styles.lens, { backgroundColor: on ? theme.rowSelected : hovered ? theme.rowHover : "transparent" }]}
          >
            <Text numberOfLines={1} style={[styles.lensText, { color: on ? theme.text : theme.textSecondary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  const lensBar = (
    <View role="tablist" style={styles.lenses}>
      {LENSES.map((option) => {
        const on = option.id === lens;
        const count = shown.filter((row) => inLens(row, option.id)).length;
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
      {mailboxBar}
      {lensBar}
    </View>
  );

  const compose = mailboxes.length ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New email"
      onPress={() => setComposingNew(true)}
      style={({ hovered }: { hovered?: boolean }) => [styles.action, { borderColor: theme.divider, backgroundColor: hovered ? theme.rowHover : "transparent" }]}
    >
      <Text style={[styles.actionText, { color: theme.text }]}>New email</Text>
    </Pressable>
  ) : null;
  const list = (
    <SidebarFrame
      chrome={wide ? <SidebarHeader testID="mail-desk-header" search={<View style={styles.fill} />} actions={compose} below={heading} /> : <SidebarChrome actions={compose} />}
      footer={wide ? <SidebarFooter workspace="mail" /> : null}
    >
      {status === "LoadingFirstPage" ? <ActivityIndicator style={styles.loading} /> : (
        <FlatList
          testID="mail-list"
          data={rows}
          keyExtractor={(row) => row._id}
          renderItem={({ item }) => <ThreadRow thread={item} selected={wide && !composingNew && selectedId === item._id} onPress={() => open(item._id as ConversationId)} />}
          ListHeaderComponent={wide ? null : (
            <View style={{ paddingTop: SIDEBAR_TITLE_HEIGHT }}>
              <Text accessibilityRole="header" style={[styles.phoneTitle, { color: theme.text }]}>Mail</Text>
              {mailboxBar}
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

  const reader = composingNew ? (
    <View testID="new-email" style={[styles.fill, { backgroundColor: theme.thread }]}>
      <ScrollView contentContainerStyle={!wide && { paddingBottom: PHONE_TAB_BAR_CLEARANCE }}>
        <EmailComposer
          conversationId={null}
          accountId={null}
          mailboxes={mailbox ? mailboxes.filter((account) => account._id === mailbox) : mailboxes}
          start={{ mode: "new" }}
          subject=""
          self={new Set()}
          hasDraft={false}
          onClose={() => setComposingNew(false)}
        />
      </ScrollView>
    </View>
  ) : selectedId ? (
    <EmailReader
      key={selectedId}
      conversationId={selectedId}
      subject={results.find((row) => row._id === selectedId)?.gmail?.subject}
      regularSenders={regular}
      onBack={wide ? undefined : () => open(null)}
    />
  ) : (
    <View style={[styles.fill, styles.center, { backgroundColor: theme.thread }]}>
      <Text style={{ color: theme.textTertiary, fontSize: 13 }}>Select a thread</Text>
    </View>
  );

  if (!wide) return <View style={[styles.fill, { backgroundColor: theme.background }]}>{selectedId || composingNew ? reader : list}</View>;
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

/**
 * `subject` is the listed row's; a thread opened from search, archived or not yet listed, reads it off its messages.
 * `regularSenders` are the lists whose images load without asking; without it, only a known sender's do.
 */
export function EmailReader({ conversationId, subject, regularSenders: regular, onBack }: {
  conversationId: ConversationId;
  subject?: string;
  regularSenders?: ReadonlySet<string>;
  onBack?: () => void;
}): JSX.Element {
  const theme = useTheme();
  const { results, status, loadMore } = usePaginatedQuery(commaApi.listMessages, { conversationId }, { initialNumItems: 25 });
  const messages = useMemo(() => [...results].sort((a, b) => a.dateCreated - b.dateCreated), [results]);
  const conversation = useQuery(commaApi.getConversation, { conversationId });
  const draft = useQuery(commaApi.getDraft, { conversationId });
  const accounts = useQuery(accountsApi.listAccounts, {});
  const [composing, setComposing] = useState<ComposerStart | null>(null);
  const [openedDraft, setOpenedDraft] = useState<number | null>(null);
  const threadSubject = subject ?? messages[0]?.subject ?? "";
  const mailbox = (accounts ?? []).find((account) => account._id === conversation?.accountId);
  // The mailbox's own addresses, and any the user sent this thread from, which a reply all leaves out.
  const self = useMemo(() => new Set([
    ...(mailbox ? [mailbox.label, ...mailbox.selfHandles ?? []] : []).map((address) => address.toLowerCase()),
    ...messages.filter((message) => message.isFromMe && message.gmail).map((message) => message.gmail!.from.address.toLowerCase()),
  ]), [mailbox, messages]);
  const replyTarget = [...messages].reverse().find((message) => message.gmail && !pendingClientKey(message.guid));
  const files = useMemo(() => threadFiles(messages), [messages]);
  const sourceOf = (message: Email): ComposerSource | null => message.gmail ? {
    guid: message.guid, isFromMe: message.isFromMe, from: message.gmail.from, to: message.gmail.to, cc: message.gmail.cc,
    name: message.isFromMe ? "you" : message.sender?.name ?? message.gmail.from.name ?? message.gmail.from.address,
    date: message.dateCreated, text: message.modelText ?? splitQuote(message.text)?.fresh ?? message.text,
  } : null;
  const compose = (mode: ReplyMode | "forward", message = replyTarget, extra: { text?: string; note?: string; files?: readonly MailFile[] } = {}) => {
    const source = message && sourceOf(message);
    if (!source) return;
    setComposing(mode === "forward"
      ? { mode, replyTo: { ...source, text: message.text }, files: messageFiles(message) }
      : { mode, replyTo: source, ...extra });
  };
  // An agent's draft for this thread opens the composer with its text and files, once per draft.
  useEffect(() => {
    if (!draft?.text || composing || openedDraft === draft.updatedAt || !replyTarget) return;
    setOpenedDraft(draft.updatedAt);
    compose("reply", replyTarget, {
      text: draft.text, ...(draft.note ? { note: draft.note } : {}),
      ...(draft.attachments?.length ? { files: draft.attachments.map(({ storageId, filename, mimeType, size }) => ({ storageId, filename, mimeType, size })) } : {}),
    });
  });
  const agentEnabled = useAgentEnabled();
  // Which messages open, fixed when the thread first loads, so reading it never folds a message away under the user.
  const [initial, setInitial] = useState<ReturnType<typeof openByDefault> | null>(null);
  if (!initial && conversation !== undefined && status !== "LoadingFirstPage" && messages.length) {
    setInitial(openByDefault(messages, conversation?.unreadCount ?? 0));
  }
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const newest = messages[messages.length - 1]?._id;
  const isOpen = (id: string) => toggled.get(id) ?? (id === newest || initial?.open.has(id) === true);
  const scroller = useRef<ScrollView>(null);
  const landed = useRef(false);
  const land = (event: LayoutChangeEvent) => {
    if (landed.current) return;
    landed.current = true;
    scroller.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 12), animated: false });
  };
  const images = conversation ? loadsRemoteImages(
    { platform: "gmail", known: conversation.known, isSpam: conversation.isSpam, bulk: conversation.gmail?.bulk },
    conversation.participants.some((participant) => regular?.has(participant.address.toLowerCase()) === true),
  ) : false;
  const settled = conversation ? !conversation.flags.unresponded && !conversation.flags.waiting : false;
  const archive = () => {
    if (!conversation) return;
    void conversationState().then((state) => settled ? state.unsettle(conversationId) : state.settle(conversationId, conversation.lastMessage?.guid))
      .catch((error: unknown) => showToast(error instanceof ConvexError ? String(error.data) : settled ? "Couldn't move it to the inbox." : "Couldn't archive it."));
  };
  return (
    <View testID="email-reader" style={[styles.fill, { backgroundColor: theme.thread }]}>
      <View style={[styles.readerHeader, { borderBottomColor: theme.divider }]}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Mail" onPress={onBack} hitSlop={8}>
            <Text style={[styles.back, { color: theme.accent }]}>Mail</Text>
          </Pressable>
        ) : null}
        <View style={styles.readerTitle}>
          <Text accessibilityRole="header" numberOfLines={2} style={[styles.readerSubject, { color: theme.text }]}>{threadSubject}</Text>
          {agentEnabled ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Ask the agent" onPress={() => openAgentPane(conversationId)} style={({ hovered }: { hovered?: boolean }) => [styles.action, { borderColor: theme.divider, backgroundColor: hovered ? theme.rowHover : "transparent" }]}>
              <Text style={[styles.actionText, { color: theme.text }]}>Ask agent</Text>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable accessibilityRole="button" onPress={archive} style={({ hovered }: { hovered?: boolean }) => [styles.action, { borderColor: theme.divider, backgroundColor: hovered ? theme.rowHover : "transparent" }]}>
              <Text style={[styles.actionText, { color: theme.text }]}>{settled ? "Move to Inbox" : "Archive"}</Text>
            </Pressable>
          ) : null}
        </View>
        {conversation?.gmail?.archiveError ? (
          <Text accessibilityRole="alert" style={[styles.archiveError, { color: theme.destructive }]}>{conversation.gmail.archiveError}</Text>
        ) : null}
      </View>
      <ScrollView ref={scroller} contentContainerStyle={styles.cards}>
        {status === "CanLoadMore" ? (
          <Pressable accessibilityRole="button" onPress={() => loadMore(25)} style={styles.more}>
            <Text style={[styles.moreText, { color: theme.textSecondary }]}>Earlier messages</Text>
          </Pressable>
        ) : null}
        {!initial ? <ActivityIndicator style={styles.loading} /> : messages.map((message) => (
          <EmailCard
            key={message._id}
            message={message}
            open={isOpen(message._id)}
            imagesByDefault={images}
            onToggle={() => setToggled((current) => new Map(current).set(message._id, !isOpen(message._id)))}
            onLayout={message._id === initial.target ? land : undefined}
            onCompose={message.gmail && !pendingClientKey(message.guid) ? (mode) => compose(mode, message) : undefined}
          />
        ))}
      </ScrollView>
      {composing ? (
        <View style={onBack && { paddingBottom: PHONE_TAB_BAR_CLEARANCE }}>
          <EmailComposer
            key={`${composing.mode === "new" ? "" : composing.replyTo.guid}:${composing.mode}:${openedDraft ?? 0}`}
            conversationId={conversationId}
            accountId={conversation?.accountId ?? null}
            mailboxes={mailbox ? [mailbox] : []}
            start={composing}
            subject={threadSubject}
            self={self}
            hasDraft={draft !== null && draft !== undefined}
            onClose={() => setComposing(null)}
          />
        </View>
      ) : (
        <View style={[styles.replyBar, onBack && { paddingBottom: PHONE_TAB_BAR_CLEARANCE }, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
          {[
            { label: "Reply", run: () => compose("reply") },
            { label: "Reply all", run: () => compose("replyAll") },
            // Copying someone onto a thread they missed: reply all with every file in the thread, each with its checkbox.
            ...(files.length ? [{ label: "Reply all with attachments", run: () => compose("replyAll", replyTarget, { files }) }] : []),
            { label: "Forward", run: () => compose("forward") },
          ].map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              disabled={!replyTarget}
              onPress={action.run}
              style={({ hovered }: { hovered?: boolean }) => [styles.action, { borderColor: theme.divider, backgroundColor: hovered ? theme.rowHover : "transparent" }]}
            >
              <Text style={[styles.actionText, { color: theme.text }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const names = (addresses: readonly { address: string; name: string | null }[]) => addresses.map((a) => a.name ?? a.address).join(", ");

/** One message: a one-line row when folded, the whole email when open. Its header folds it again. */
function EmailCard({ message, open, imagesByDefault, onToggle, onLayout, onCompose }: {
  message: Email;
  open: boolean;
  imagesByDefault: boolean;
  onToggle: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Reply, reply all or forward this message; absent while it is still sending. */
  onCompose?: (mode: ReplyMode | "forward") => void;
}): JSX.Element {
  const theme = useTheme();
  const [asked, setAsked] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const from = message.gmail?.from ?? message.sender ?? { address: "", name: null };
  const name = message.isFromMe ? "You" : message.sender?.name ?? from.name ?? from.address;
  const html = message.gmail?.html;
  const blocked = message.gmail?.blockedImages ?? 0;
  const images = imagesByDefault || asked;
  const split = splitQuote(message.text);
  const when = formatReceiptTime(message.dateCreated);
  const inlineImages = useInlineImages(open && html !== undefined ? message.attachments : []);
  if (!open) {
    const snippet = (message.modelText ?? split?.fresh ?? message.text).replace(/\s+/g, " ").trim();
    return (
      <Pressable
        testID="email-card"
        aria-expanded={false}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${snippet}, ${when}`}
        onPress={onToggle}
        onLayout={onLayout}
        style={({ hovered }: { hovered?: boolean }) => [styles.card, styles.folded, { backgroundColor: hovered ? theme.rowHover : theme.surface, borderColor: theme.divider }]}
      >
        <Text numberOfLines={1} style={[styles.from, styles.foldedName, { color: theme.text }]}>{name}</Text>
        <Text numberOfLines={1} style={[styles.foldedSnippet, { color: theme.textSecondary }]}>{snippet}</Text>
        <Text style={[styles.time, { color: theme.textTertiary }]}>{when}</Text>
      </Pressable>
    );
  }
  return (
    <View testID="email-card" aria-expanded onLayout={onLayout} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.divider }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Fold the message from ${name}`} onPress={onToggle} style={styles.cardHead}>
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
        <Text style={[styles.time, { color: theme.textTertiary }]}>{when}</Text>
      </Pressable>
      {message.sendState ? <SendState clientKey={pendingClientKey(message.guid) ?? ""} state={message.sendState} /> : null}
      {html !== undefined && Platform.OS === "web" ? (
        <>
          {blocked > 0 && !images ? (
            <Pressable accessibilityRole="button" onPress={() => setAsked(true)} style={[styles.loadImages, { borderColor: theme.divider }]}>
              <Text style={[styles.loadImagesText, { color: theme.accent }]}>Load images</Text>
              <Text style={[styles.loadImagesNote, { color: theme.textTertiary }]}>{blocked === 1 ? "1 remote image is blocked" : `${blocked} remote images are blocked`}</Text>
            </Pressable>
          ) : null}
          <EmailFrame html={html} images={images} inline={inlineImages} title={`Email from ${name}`} />
        </>
      ) : (
        // ponytail: phones show the plain text; a JavaScript-off WebView for the HTML needs react-native-webview in an EAS build.
        <View style={styles.plainBody}>
          <Text selectable style={[styles.plain, { color: theme.text }]}>{split ? split.fresh : message.text}</Text>
          {split ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={quoteOpen ? "Hide quoted text" : "Show quoted text"}
              aria-expanded={quoteOpen}
              onPress={() => setQuoteOpen(!quoteOpen)}
              style={({ hovered }: { hovered?: boolean }) => [styles.fold, { backgroundColor: hovered ? theme.rowSelected : theme.rowHover }]}
            >
              <Text style={[styles.foldText, { color: theme.textSecondary }]}>•••</Text>
            </Pressable>
          ) : null}
          {split && quoteOpen ? <Text selectable style={[styles.plain, { color: theme.textSecondary }]}>{split.quote}</Text> : null}
        </View>
      )}
      <EmailFiles message={message} />
      {onCompose ? (
        <View style={styles.cardActions}>
          {([["reply", "Reply"], ["replyAll", "Reply all"], ["forward", "Forward"]] as const).map(([mode, label]) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityLabel={`${label} to the message from ${name}`}
              onPress={() => onCompose(mode)}
              style={({ hovered }: { hovered?: boolean }) => [styles.cardAction, { backgroundColor: hovered ? theme.rowHover : "transparent" }]}
            >
              <Text style={[styles.cardActionText, { color: theme.textSecondary }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type Attachment = Email["attachments"][number];
const shownAsFile = (attachment: Attachment) => !attachment.gmail?.inline;
const isImage = (attachment: Attachment) => attachment.mimeType?.startsWith("image/") === true;

/** A message's files: images as thumbnails that open in the lightbox, the rest as tiles that open the file. Inline images draw in the body. */
function EmailFiles({ message }: { message: Email }): JSX.Element | null {
  const openLightbox = useLightbox();
  const shown = message.attachments.filter(shownAsFile);
  if (!shown.length) return null;
  const photos = shown.filter((attachment) => isImage(attachment) && attachment.originalUrl);
  const media = photos.map((attachment) => ({ guid: attachment.guid, originalUrl: attachment.originalUrl, thumbUrl: attachment.thumbUrl, isVideo: false }));
  return (
    <View testID="email-files" style={styles.emailFiles}>
      {photos.map((attachment, index) => (
        <Pressable
          key={attachment.guid}
          accessibilityRole="button"
          accessibilityLabel={`Open ${attachment.filename ?? "photo"}`}
          onPress={() => openLightbox(media, index)}
          style={styles.thumb}
        >
          <Image source={{ uri: attachment.thumbUrl ?? attachment.originalUrl! }} style={styles.thumbImage} contentFit="cover" />
        </Pressable>
      ))}
      {shown.filter((attachment) => !photos.includes(attachment)).map((attachment) => (
        <FileCard
          key={attachment.guid}
          filename={attachment.filename ?? "Attachment"}
          bytes={attachment.totalBytes ?? null}
          onPress={attachment.originalUrl ? () => void openExternalUrl(attachment.originalUrl!) : undefined}
        />
      ))}
    </View>
  );
}

/**
 * The message's inline images as data: URLs by Content-ID, read from storage on the web, so the sandboxed frame shows
 * them under its CSP, which allows data: images and nothing remote.
 */
function useInlineImages(attachments: readonly Attachment[]): Readonly<Record<string, string>> {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const wanted = attachments.filter((attachment) => attachment.gmail?.inline && attachment.gmail.contentId && isImage(attachment) && attachment.originalUrl);
  const key = wanted.map((attachment) => attachment.guid).join(" ");
  useEffect(() => {
    if (!key || Platform.OS !== "web") return;
    let live = true;
    void Promise.all(wanted.map(async (attachment) => {
      const blob = await (await fetch(attachment.originalUrl!)).blob();
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob.slice(0, blob.size, attachment.mimeType));
      });
      return [attachment.gmail!.contentId!, url] as const;
    })).then((entries) => {
      if (live) setUrls(Object.fromEntries(entries));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the attachments' guids, which fix their URLs.
  }, [key]);
  return urls;
}

/** Where an email that has not landed stands. An unknown outcome is never offered for a resend. */
function SendState({ clientKey, state }: { clientKey: string; state: NonNullable<Email["sendState"]> }): JSX.Element {
  const theme = useTheme();
  const [row] = useQuery(commaApi.outboxStatusFor, state === "failed" ? { clientKeys: [clientKey] } : "skip") ?? [];
  const copy = state === "queued" || state === "sending" ? "Sending…"
    : state === "notSent" ? "Not sent. Nothing took it in time."
      : row?.status === "unknown" ? "Not sure this went through. Check Sent in Gmail before sending again."
        : `Couldn't send${row?.error ? `: ${row.error}` : "."}`;
  return <Text style={[styles.sendState, { color: state === "failed" || state === "notSent" ? theme.destructive : theme.textTertiary }]}>{copy}</Text>;
}

/** The cleaned HTML in a sandboxed iframe that runs no scripts, its quotes folded, sized to its content as they open. */
function EmailFrame({ html, images, inline, title }: { html: string; images: boolean; inline: Readonly<Record<string, string>>; title: string }): JSX.Element {
  const [height, setHeight] = useState(120);
  return createElement("iframe", {
    title,
    srcDoc: emailDocument(html, { images, inline }),
    sandbox: EMAIL_SANDBOX,
    referrerPolicy: "no-referrer",
    style: { border: 0, width: "100%", height, background: "#fff", borderRadius: 8 },
    onLoad: (event: { currentTarget: HTMLIFrameElement }) => {
      const doc = event.currentTarget.contentDocument;
      if (!doc) return;
      foldQuotes(doc);
      // The body, not the document: the document is never shorter than the frame, so a folded quote would leave a gap.
      const fit = () => setHeight(doc.body.scrollHeight + 4);
      doc.addEventListener("toggle", fit, true);
      fit();
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
  readerTitle: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  readerSubject: { ...headerFace, flex: 1, fontSize: 19, letterSpacing: -0.3 },
  archiveError: { fontSize: 12.5 },
  action: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 6 },
  actionText: { fontSize: 13, fontWeight: "600" },
  sendState: { fontSize: 12.5 },
  cards: { gap: 12, padding: 20, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  cardHead: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  from: { fontSize: 14, fontWeight: "600" },
  to: { fontSize: 12.5, paddingTop: 2 },
  plain: { fontSize: 14, lineHeight: 21 },
  plainBody: { alignItems: "flex-start", gap: 8 },
  fold: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 1 },
  foldText: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  folded: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 11 },
  foldedName: { flexShrink: 0, maxWidth: "30%" },
  foldedSnippet: { flex: 1, fontSize: 13.5 },
  loadImages: { alignItems: "center", borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  loadImagesText: { fontSize: 13, fontWeight: "600" },
  loadImagesNote: { fontSize: 12.5 },
  cardActions: { flexDirection: "row", gap: 4, marginLeft: -8 },
  cardAction: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  cardActionText: { fontSize: 12.5, fontWeight: "600" },
  emailFiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { borderRadius: 10, height: 120, overflow: "hidden", width: 160 },
  thumbImage: { height: 120, width: 160 },
  replyBar: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
});
