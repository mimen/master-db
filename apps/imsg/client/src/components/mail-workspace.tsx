import type { api as convexApi } from "@convex-api";
import Ionicons from "@expo/vector-icons/Ionicons";
import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon";
import ArchiveRestoreIcon from "@hugeicons/core-free-icons/ArchiveRestoreIcon";
import ArrowTurnForwardIcon from "@hugeicons/core-free-icons/ArrowTurnForwardIcon";
import Attachment01Icon from "@hugeicons/core-free-icons/Attachment01Icon";
import MailReply01Icon from "@hugeicons/core-free-icons/MailReply01Icon";
import MailReplyAll01Icon from "@hugeicons/core-free-icons/MailReplyAll01Icon";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { splitQuote } from "@shared/email-quote";
import { pendingClientKey } from "@shared/pending-send";
import { loadsRemoteImages } from "@shared/platform-profile";
import type { ChatSummary, ConversationId } from "@shared/types";
import { isSnoozed, settleActionFor } from "@shared/chat-state";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { anyApi, type FunctionReturnType } from "convex/server";
import { router, useGlobalSearchParams } from "expo-router";
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ReplyMode } from "@shared/email-reply";
import { Image } from "expo-image";

import { ChatRow } from "@/components/chat-row";
import { useDesktopShellContext, useDesktopShellState } from "@/components/desktop-shell-context";
import { DesktopSplit } from "@/components/desktop-split";
import { EmailComposer, type ComposerSource, type ComposerStart } from "@/components/email-composer";
import { SelectionEmpty } from "@/components/empty-state";
import { FileCard } from "@/components/media";
import { LiquidTabs } from "@/components/motion/liquid-tabs";
import { PHONE_TAB_BAR_CLEARANCE } from "@/components/phone-tab-bar";
import { ChromeIconButton } from "@/components/sidebar/chrome-icon-button";
import { SidebarChrome } from "@/components/sidebar/sidebar-chrome";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import { SidebarFrame } from "@/components/sidebar/sidebar-frame";
import { SidebarHeader } from "@/components/sidebar/sidebar-header";
import { SidebarSearchField } from "@/components/sidebar/sidebar-search-field";
import { BackButton } from "@/components/ui/back-button";
import { IconButton } from "@/components/ui/icon-button";
import { TriageGeometry } from "@/constants/triage-theme";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useConversation } from "@/hooks/use-chat-directory";
import { useTheme } from "@/hooks/use-theme";
import { useToday } from "@/hooks/use-today";
import { onTriageSettling, toggleSettleChat } from "@/hooks/use-triage-actions";
import { pressAnchor, useActionSheet } from "@/lib/action-sheet";
import { openAgentPane } from "@/lib/agent-pane";
import { api } from "@/lib/api";
import { markChatUnread, readChat, undoLastAction } from "@/lib/chat-actions";
import { hasEveryWord, normalizeSearchQuery } from "@/lib/conversation-search";
import { conversationToChat } from "@/lib/convex-adapters";
import { commaApi, pendingSendsApi } from "@/lib/convex-api";
import { formatReceiptTime } from "@/lib/format";
import { headerFace, toolbarTitle } from "@/lib/header-font";
import { openExternalUrl } from "@/lib/external-link";
import { useLightbox } from "@/lib/lightbox";
import { isShown, registerEscapeCloser, runEscapeClosers, setKeyboardRuntime } from "@/lib/keyboard/controller";
import { shortcutFor } from "@/lib/keyboard/registry";
import { EMAIL_SANDBOX, emailDocument, foldQuotes, messageFiles, openByDefault, threadFiles, type MailFile } from "@/lib/mail";
import { openDeferMenu } from "@/lib/later";
import { inLens, regularSenders, type MailLens } from "@/lib/mail-lens";
import { setMailSelection } from "@/lib/mail-selection";
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";
import { messagingCommandError } from "@/lib/messaging-api";
import { showToast } from "@/lib/toast";

/**
 * The Mail workspace: inbox threads under two lenses, drawn with the Messages row, tabs and header. With two mailboxes
 * connected, a header menu narrows the list to one, and each row's Gmail mark carries a dot for the personal mailbox.
 * The reader shows each message as a card with its files; the newest carries Reply, Reply all and Forward, and the
 * others show them on hover or tap. A thread opens at its first unread message, or its newest, with the rest folded to
 * one line and quoted history behind "•••". A snoozed thread leaves the list until Later brings it back.
 */

type Thread = FunctionReturnType<typeof commaApi.listEmailThreads>["page"][number];
type Email = FunctionReturnType<typeof commaApi.listMessages>["page"][number];

const accountsApi = anyApi.comma.accounts as unknown as typeof convexApi.comma.accounts;
const LENSES: readonly { key: MailLens; label: string }[] = [{ key: "people", label: "People" }, { key: "all", label: "All inbox" }];
/** The reader's column, as wide as the Messages thread's. */
const READER_WIDTH = 760;

const searchText = (row: Thread) =>
  [row.displayName, row.gmail?.subject ?? "", row.lastMessage?.text ?? "", ...row.participants.map((p) => `${p.name ?? ""} ${p.address}`)].join(" ");

/** `active`: the wide shell shows Mail, so the keyboard acts on it. `onReader`: the phone reader opened or closed. */
export function MailWorkspace({ wide, active = false, onReader }: {
  readonly wide: boolean;
  readonly active?: boolean;
  readonly onReader?: (open: boolean) => void;
}): JSX.Element {
  const theme = useTheme();
  const { isAuthenticated } = useConvexAuth();
  const [lens, setLensState] = useState<MailLens>("people");
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null);
  const [composingNew, setComposingNew] = useState(false);
  const open = (id: ConversationId | null) => {
    setComposingNew(false);
    setSelectedId(id);
  };
  const openChat = useCallback((chat: ChatSummary) => {
    setComposingNew(false);
    setSelectedId(chat.conversationId);
  }, []);
  // The wide shell's agent pane follows the open thread.
  useEffect(() => {
    setMailSelection(wide && !composingNew ? selectedId : null);
    return () => setMailSelection(null);
  }, [wide, selectedId, composingNew]);
  const pushed = !wide && (selectedId !== null || composingNew);
  useEffect(() => onReader?.(pushed), [onReader, pushed]);
  // Search opens a mail hit as /mail?thread=<id>.
  const { thread: routed } = useGlobalSearchParams<{ thread?: string }>();
  useEffect(() => {
    if (routed) open(routed as ConversationId);
  }, [routed]);
  const { results, status, loadMore } = usePaginatedQuery(commaApi.listEmailThreads, isAuthenticated ? {} : "skip", { initialNumItems: 50 });
  // Later takes a thread out of Mail until it comes back, as it leaves every Messages queue.
  const inbox = useMemo(() => results.filter((row) => !isSnoozed(row)), [results]);
  const accounts = useQuery(accountsApi.listAccounts, isAuthenticated ? {} : "skip");
  const mailboxes = useMemo(() => (accounts ?? []).filter((account) => account.platform === "gmail" && account.connected)
    .sort((a, b) => Number(a.gmailApp === "personal") - Number(b.gmailApp === "personal")), [accounts]);
  const personal = useMemo(() => new Set(mailboxes.flatMap((account) => account.gmailApp === "personal" ? [account._id as string] : [])), [mailboxes]);
  const [chosen, setChosen] = useState<string | null>(null);
  const mailbox = mailboxes.length > 1 && mailboxes.some((account) => account._id === chosen) ? chosen : null;
  const mailboxName = (id: string | null) => (id === null ? "All" : personal.has(id) ? "Personal" : "AUF");

  // Search spans both lenses of the chosen mailbox: the loaded threads by sender, subject and snippet, and any whose
  // message bodies match. Matches outside the loaded inbox (archived, or pages deep) open in Search.
  const [query, setQuery] = useState("");
  const needle = normalizeSearchQuery(query);
  const searchRef = useRef<TextInput>(null);
  const [deep, setDeep] = useState<{ query: string; ids: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (needle.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      api.search(needle, { platform: "gmail" })
        .then((hits) => current && setDeep({ query: needle, ids: new Set(hits.filter((hit) => hasEveryWord(hit.text, needle)).map((hit) => hit.conversationId)) }))
        .catch(() => undefined);
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [needle]);
  const deepIds = deep?.query === needle ? deep.ids : null;

  // ponytail: narrows the loaded pages on the client; a server-side filter when one mailbox's threads sit pages deep.
  const listed = (inMailbox: string | null, inThisLens: MailLens) =>
    inbox.filter((row) => (!inMailbox || row.accountId === inMailbox) && inLens(row, inThisLens));
  const shown = useMemo(() => mailbox ? inbox.filter((row) => row.accountId === mailbox) : inbox, [inbox, mailbox]);
  const rows = useMemo(() => needle
    ? shown.filter((row) => hasEveryWord(searchText(row), needle) || deepIds?.has(row._id) === true)
    : shown.filter((row) => inLens(row, lens)), [shown, lens, needle, deepIds]);
  const chats = useMemo(() => rows.map(conversationToChat), [rows]);
  const elsewhere = deepIds ? [...deepIds].filter((id) => !shown.some((row) => row._id === id)).length : 0;
  const counts = useMemo(() => ({ people: shown.filter((row) => inLens(row, "people")).length, all: shown.length }), [shown]);
  // A switch of mailbox or lens closes a thread the new list does not hold.
  const narrowTo = (nextMailbox: string | null, nextLens: MailLens) => {
    if (selectedId && !listed(nextMailbox, nextLens).some((row) => row._id === selectedId)) open(null);
    setChosen(nextMailbox);
    setLensState(nextLens);
  };
  const setLens = (next: MailLens) => {
    setQuery("");
    narrowTo(mailbox, next);
  };
  const setMailbox = (next: string | null) => narrowTo(next, lens);
  const more = shown.length - counts.people;
  // ponytail: counts the loaded pages only; a per-sender count in Convex if a monthly list keeps reading as irregular.
  const regular = useMemo(() => regularSenders(results), [results]);

  // Keyboard (docs/keyboard-design.md), the way Contacts and Messages register theirs: ⌘E archives the open thread,
  // H snoozes it, j/k walk the list, ⌘J asks the agent, Esc closes what is on top. Read through refs, so a key acts on
  // current state.
  const { closeTopSurface, closeUtility, openHelp, openPalette } = useDesktopShellContext();
  const showSheet = useActionSheet();
  const agentOpen = useDesktopShellState((state) => state.utility?.kind === "agent" && state.utility.workspace === "mail");
  const agentEnabled = useAgentEnabled();
  const selectedChat = useConversation(selectedId);
  const live = useRef({ chats, selectedId, selectedChat, agentOpen, agentEnabled, composeNew: () => setComposingNew(true), open, canCompose: mailboxes.length > 0 });
  useEffect(() => {
    live.current = { chats, selectedId, selectedChat, agentOpen, agentEnabled, composeNew: () => setComposingNew(true), open, canCompose: mailboxes.length > 0 };
  });
  // Archiving or snoozing the open thread moves on to the next one, as Today, Needs you and Unread do in Messages; the
  // last one stays.
  const advanceFrom = useCallback((conversationId: ConversationId) => {
    const { chats: list, selectedId: current, open: show } = live.current;
    if (conversationId !== current) return;
    const at = list.findIndex((chat) => chat.conversationId === conversationId);
    const next = at < 0 ? undefined : list[at + 1] ?? list[at - 1];
    if (next) show(next.conversationId);
  }, []);
  useEffect(() => onTriageSettling(advanceFrom), [advanceFrom]);
  useEffect(() => {
    if (Platform.OS !== "web" || !wide || !active) return;
    const thread = (): ChatSummary | null => {
      const chat = live.current.selectedChat;
      if (!chat) showToast("Select a thread first");
      return chat ?? null;
    };
    const closePanel = (): boolean => {
      if (closeTopSurface() || runEscapeClosers()) return true;
      if (live.current.agentOpen) {
        closeUtility();
        return true;
      }
      if (!live.current.selectedId) return false;
      live.current.open(null);
      return true;
    };
    setKeyboardRuntime({
      openPalette: () => openPalette(false),
      openNewMessage: () => (live.current.canCompose ? live.current.composeNew() : openPalette(true)),
      openHelp,
      moveSelection: (delta) => {
        const { chats: list, selectedId: current, open: show } = live.current;
        const at = list.findIndex((chat) => chat.conversationId === current);
        const next = list[at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta))];
        if (next) show(next.conversationId);
      },
      activateSelection: () => undefined,
      findInConversation: () => undefined,
      settleSelected: () => {
        const chat = thread();
        if (chat) void toggleSettleChat(chat);
      },
      markUnreadSelected: () => {
        const chat = thread();
        if (chat) markChatUnread(chat, () => showToast("Marked unread — ⌘⇧Z to undo"));
      },
      deferSelected: (kind) => {
        const chat = thread();
        if (chat) openDeferMenu(showSheet, chat, kind, { onPicked: kind === "later" ? () => advanceFrom(chat.conversationId) : undefined });
      },
      toggleDetails: () => undefined,
      openAgent: () => {
        const { selectedId: current, agentEnabled: enabled } = live.current;
        if (current && enabled) openAgentPane(current);
      },
      focusListSearch: () => searchRef.current?.focus(),
      undoLast: () => showToast(undoLastAction() ? "Undone" : "Nothing to undo"),
      escape: () => {
        if (closeTopSurface() || runEscapeClosers()) return;
        if (live.current.agentOpen) {
          closeUtility();
          return;
        }
        const focused = globalThis.document?.activeElement;
        if (focused instanceof HTMLElement) focused.blur();
      },
      closePanel,
    });
    return () => setKeyboardRuntime(null);
  }, [active, wide, advanceFrom, closeTopSurface, closeUtility, openHelp, openPalette, showSheet]);

  const mailboxControl = mailboxes.length > 1 ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Mailbox, ${mailboxName(mailbox)}`}
      onPress={(event) => showSheet({
        title: "Mailbox",
        anchor: { ...pressAnchor(event), align: "end" },
        actions: [null, ...mailboxes.map((account) => account._id as string)].map((id) => ({
          label: id === null ? "All mailboxes" : mailboxName(id),
          ...(id === mailbox ? { icon: "checkmark" as const } : {}),
          onPress: () => setMailbox(id),
        })),
      })}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.mailbox,
        wide ? styles.mailboxWide : styles.mailboxPhone,
        (hovered || pressed) && { backgroundColor: pressed ? theme.rowSelected : theme.rowHover },
      ]}
    >
      <Text numberOfLines={1} style={[styles.mailboxText, { color: theme.textSecondary, fontSize: wide ? 12.5 : 15 }]}>{mailboxName(mailbox)}</Text>
      <Ionicons aria-hidden name="chevron-down" size={wide ? 11 : 14} color={theme.textTertiary} />
    </Pressable>
  ) : null;

  const lensTabs = (
    <LiquidTabs
      tabs={LENSES.map((option) => ({ ...option, accessibilityLabel: `${option.label}, ${counts[option.key]}` }))}
      value={lens}
      onChange={setLens}
      underline={wide}
      style={wide ? styles.tabs : styles.tabsPhone}
      tabStyle={wide ? null : styles.tabPhone}
      renderLabel={(tab, color) => (
        <>
          <Text numberOfLines={1} style={[wide ? styles.tabLabel : styles.tabLabelPhone, { color }]}>{tab.label}</Text>
          <Text style={[wide ? styles.tabCount : styles.tabCountPhone, { color: theme.textTertiary }]}>{counts[tab.key]}</Text>
        </>
      )}
    />
  );
  const searchField = (
    <SidebarSearchField
      value={query}
      accessibilityLabel="Search mail"
      placeholder="Search mail"
      inputRef={searchRef}
      onChangeText={setQuery}
      onClear={() => setQuery("")}
      shortcut={shortcutFor("list.focusSearch")}
    />
  );
  const compose = mailboxes.length ? <ChromeIconButton hugeIcon={PencilEdit02Icon} accessibilityLabel="New email" onPress={() => setComposingNew(true)} /> : null;

  const list = (
    <SidebarFrame
      chrome={wide ? (
        <SidebarHeader
          testID="mail-desk-header"
          search={searchField}
          actions={compose}
          below={(
            <View style={styles.lensRow}>
              {/* The tabs show the lens; this names the workspace for screen readers and the page outline. */}
              <Text accessibilityRole="header" style={styles.visuallyHidden}>Mail</Text>
              {lensTabs}
              {mailboxControl}
            </View>
          )}
        />
      ) : <SidebarChrome actions={<>{mailboxControl}{compose}</>} />}
      footer={wide ? <SidebarFooter workspace="mail" /> : null}
    >
      {status === "LoadingFirstPage" ? <ActivityIndicator style={styles.loading} /> : (
        <FlatList
          testID="mail-list"
          data={chats}
          keyExtractor={(chat) => chat.conversationId}
          renderItem={({ item }) => (
            <ChatRow
              testID="mail-row"
              chat={item}
              personal={personal.has(item.route.accountId ?? "")}
              selected={wide && !composingNew && selectedId === item.conversationId}
              onOpen={openChat}
            />
          )}
          ListHeaderComponent={wide ? null : (
            <View style={{ paddingTop: SIDEBAR_TITLE_HEIGHT }}>
              <Text accessibilityRole="header" style={styles.visuallyHidden}>Mail</Text>
              <View style={styles.phoneLenses}>{lensTabs}</View>
              <View style={styles.phoneSearch}>{searchField}</View>
            </View>
          )}
          ListFooterComponent={needle ? (elsewhere > 0 ? (
            <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/search", params: { query: needle } })} style={styles.more}>
              <Text style={[styles.moreText, { color: theme.textSecondary }]}>{elsewhere} more in Search</Text>
            </Pressable>
          ) : null) : lens === "people" && more > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setLens("all")} style={styles.more}>
              <Text style={[styles.moreText, { color: theme.textSecondary }]}>{more} more in All inbox</Text>
            </Pressable>
          ) : null}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.textTertiary }]}>
              {needle ? "No matches." : lens === "people" ? "No one is waiting on a reply." : "The inbox is empty."}
            </Text>
          }
          onEndReached={() => status === "CanLoadMore" && loadMore(50)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { paddingBottom: wide ? 12 : PHONE_TAB_BAR_CLEARANCE }]}
        />
      )}
    </SidebarFrame>
  );

  const reader = composingNew ? (
    <NewEmail
      mailboxes={mailbox ? mailboxes.filter((account) => account._id === mailbox) : mailboxes}
      onClose={() => setComposingNew(false)}
      onBack={wide ? undefined : () => setComposingNew(false)}
    />
  ) : selectedId ? (
    <EmailReader
      key={selectedId}
      conversationId={selectedId}
      subject={results.find((row) => row._id === selectedId)?.gmail?.subject}
      regularSenders={regular}
      onBack={wide ? undefined : () => open(null)}
    />
  ) : <SelectionEmpty icon="mail-outline" message="Select a thread" />;

  if (!wide) return <View style={[styles.fill, { backgroundColor: theme.background }]}>{pushed ? reader : list}</View>;
  return <DesktopSplit list={list} detail={reader} />;
}

/** New email, in the reader's place, with the reader's column and its bottom inset on a phone. */
function NewEmail({ mailboxes, onClose, onBack }: {
  mailboxes: Parameters<typeof EmailComposer>[0]["mailboxes"];
  onClose: () => void;
  onBack?: () => void;
}): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID="new-email" style={[styles.fill, { backgroundColor: theme.thread }]}>
      {onBack ? (
        <View style={[styles.readerHeader, styles.readerHeaderPhone, { borderBottomColor: theme.divider }]}>
          <BackButton onPress={onBack} label="Back to Mail" />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={[styles.column, { paddingBottom: insets.bottom }]}>
        <EmailComposer conversationId={null} accountId={null} mailboxes={mailboxes} start={{ mode: "new" }} subject="" self={new Set()} hasDraft={false} onClose={onClose} />
      </ScrollView>
    </View>
  );
}

/**
 * `subject` is the listed row's; a thread opened from search, archived or not yet listed, reads it off its messages.
 * `regularSenders` are the lists whose images load without asking; without it, only a known sender's do.
 */
export function EmailReader({ conversationId, subject, regularSenders: listed, onBack }: {
  conversationId: ConversationId;
  subject?: string;
  regularSenders?: ReadonlySet<string>;
  onBack?: () => void;
}): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Opened from Today, the reader judges images by the same inbox threads Mail does.
  const today = useToday();
  const regular = listed ?? today.regularSenders;
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
  const compose = (mode: CardAction, message = replyTarget, extra: { text?: string; note?: string; files?: readonly MailFile[] } = {}) => {
    const source = message && sourceOf(message);
    if (!source) return;
    setComposing(mode === "forward" ? { mode, replyTo: { ...source, text: message.text }, files: messageFiles(message) }
      // Copying someone onto a thread they missed: reply all with every file in the thread, each with its checkbox.
      : mode === "replyAllFiles" ? { mode: "replyAll", replyTo: source, files }
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
  // Read once the unread messages it opens on are fixed, so the read can't fold them away.
  const opened = initial !== null && conversation !== null;
  useEffect(() => {
    if (opened) readChat(conversationId).catch(() => undefined);
  }, [conversationId, opened]);
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
  // Archive is the one triage gesture, so it answers with a toast and Undo, and moves Mail on to the next thread.
  const chat = useMemo(() => (conversation ? conversationToChat(conversation) : null), [conversation]);
  const settled = chat ? settleActionFor(chat) === "unsettle" : false;
  const archive = () => {
    if (chat) void toggleSettleChat(chat);
  };
  // Esc closes the composer while it holds nothing the user wrote.
  const composerBox = useRef<View>(null);
  useEffect(() => {
    if (!composing) return;
    return registerEscapeCloser(() => {
      const box = composerBox.current as unknown as HTMLElement | null;
      if (!isShown(box)) return false;
      const body = box?.querySelector?.("textarea");
      if (body && body.value.trim() !== "") return false;
      setComposing(null);
      return true;
    });
  }, [composing]);
  const glyph = (icon: IconSvgElement) => ({ active }: { active: boolean }) => (
    <HugeiconsIcon icon={icon} size={18} color={active ? theme.text : theme.icon} strokeWidth={1.6} />
  );
  // The phone's bottom inset belongs to whatever sits last: the composer when it is open, the cards otherwise.
  const bottom = onBack ? insets.bottom : 0;
  return (
    <View testID="email-reader" style={[styles.fill, { backgroundColor: theme.thread }]}>
      <View style={[styles.readerHeader, onBack ? styles.readerHeaderPhone : styles.readerHeaderWide, { borderBottomColor: theme.divider }]}>
        {onBack ? <BackButton onPress={onBack} label="Back to Mail" /> : null}
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.readerSubject, { color: theme.text }]}>{threadSubject}</Text>
        <View style={styles.readerActions}>
          {agentEnabled ? (
            <IconButton label={onBack ? "Ask the agent" : "Ask the agent (⌘J)"} onPress={() => openAgentPane(conversationId)} style={styles.headerIconButton}>
              {glyph(SparklesIcon)}
            </IconButton>
          ) : null}
          {conversation ? (
            <IconButton label={settled ? "Move to Inbox" : "Archive"} onPress={archive} style={styles.headerIconButton}>
              {glyph(settled ? ArchiveRestoreIcon : Archive02Icon)}
            </IconButton>
          ) : null}
        </View>
      </View>
      {conversation?.gmail?.archiveError ? (
        <Text accessibilityRole="alert" style={[styles.archiveError, { color: theme.destructive, borderBottomColor: theme.divider }]}>{conversation.gmail.archiveError}</Text>
      ) : null}
      <ScrollView ref={scroller} contentContainerStyle={[styles.column, styles.cards, { paddingBottom: 32 + (composing ? 0 : bottom) }]}>
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
            latest={message._id === replyTarget?._id}
            imagesByDefault={images}
            onToggle={() => setToggled((current) => new Map(current).set(message._id, !isOpen(message._id)))}
            onLayout={message._id === initial.target ? land : undefined}
            onCompose={message.gmail && !pendingClientKey(message.guid) ? (mode) => compose(mode, message) : undefined}
            withFiles={message._id === replyTarget?._id && files.length > 0}
            onEditResend={pendingClientKey(message.guid) ? () => compose("reply", messages.find((m) => m.guid === message.replyToGuid) ?? replyTarget, { text: message.text }) : undefined}
          />
        ))}
      </ScrollView>
      {composing ? (
        <View ref={composerBox} style={[styles.column, { paddingBottom: bottom }]}>
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
      ) : null}
    </View>
  );
}

type CardAction = ReplyMode | "forward" | "replyAllFiles";
const CARD_ACTIONS: readonly { mode: CardAction; label: string; icon: IconSvgElement }[] = [
  { mode: "reply", label: "Reply", icon: MailReply01Icon },
  { mode: "replyAll", label: "Reply all", icon: MailReplyAll01Icon },
  { mode: "forward", label: "Forward", icon: ArrowTurnForwardIcon },
];

const names = (addresses: readonly { address: string; name: string | null }[]) => addresses.map((a) => a.name ?? a.address).join(", ");

/**
 * One message: a one-line row when folded, the whole email when open. Its header folds it again. Reply, Reply all and
 * Forward sit in the header of the newest message; an older one shows them while hovered, or once tapped.
 */
function EmailCard({ message, open, latest, imagesByDefault, onToggle, onLayout, onCompose, onEditResend, withFiles }: {
  message: Email;
  open: boolean;
  latest: boolean;
  imagesByDefault: boolean;
  onToggle: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Reply, reply all or forward this message; absent while it is still sending. */
  onCompose?: (mode: CardAction) => void;
  /** Offer Reply all with the thread's files. */
  withFiles: boolean;
  /** A reply of the user's that did not go out: opens the composer with what was written. */
  onEditResend?: () => void;
}): JSX.Element {
  const theme = useTheme();
  const [asked, setAsked] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
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
        style={({ hovered: over }: { hovered?: boolean }) => [styles.card, styles.folded, { backgroundColor: over ? theme.rowHover : theme.surface, borderColor: theme.divider }]}
      >
        <Text numberOfLines={1} style={[styles.from, styles.foldedName, { color: theme.text }]}>{name}</Text>
        <Text numberOfLines={1} style={[styles.foldedSnippet, { color: theme.textSecondary }]}>{snippet}</Text>
        <Text style={[styles.time, { color: theme.textTertiary }]}>{when}</Text>
      </Pressable>
    );
  }
  const actions = onCompose ? [...CARD_ACTIONS, ...(withFiles ? [{ mode: "replyAllFiles" as const, label: "Reply all with attachments", icon: Attachment01Icon }] : [])] : [];
  const shown = latest || hovered || tapped;
  return (
    <Pressable
      testID="email-card"
      aria-expanded
      focusable={false}
      onLayout={onLayout}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => setTapped(true)}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.divider }, NO_POINTER]}
    >
      <View style={styles.cardHead}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Fold the message from ${name}`} onPress={onToggle} style={styles.cardFold}>
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
        {actions.length ? (
          // Drawn but transparent until shown, so revealing them never moves the header.
          <View style={[styles.cardActions, !shown && styles.cardActionsHidden]}>
            {actions.map((action) => (
              <IconButton key={action.mode} label={`${action.label} to the message from ${name}`} onPress={() => onCompose!(action.mode)}>
                {({ active }) => <HugeiconsIcon icon={action.icon} size={17} color={active ? theme.text : theme.icon} strokeWidth={1.6} />}
              </IconButton>
            ))}
          </View>
        ) : null}
      </View>
      {message.sendState ? <SendState clientKey={pendingClientKey(message.guid) ?? ""} state={message.sendState} onEdit={onEditResend} /> : null}
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
              style={({ hovered: over }: { hovered?: boolean }) => [styles.fold, { backgroundColor: over ? theme.rowSelected : theme.rowHover }]}
            >
              <Text style={[styles.foldText, { color: theme.textSecondary }]}>•••</Text>
            </Pressable>
          ) : null}
          {split && quoteOpen ? <Text selectable style={[styles.plain, { color: theme.textSecondary }]}>{split.quote}</Text> : null}
        </View>
      )}
      <EmailFiles message={message} />
    </Pressable>
  );
}

// The card is a hover and tap target, not a control: no pointer over its text.
const NO_POINTER = Platform.OS === "web" ? ({ cursor: "auto" } as object) : null;

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

/**
 * Where an email that has not landed stands, and what to do with one that did not go out: Retry, Edit and resend, or
 * Discard. An unknown outcome is never offered for a Retry; it may have gone.
 */
function SendState({ clientKey, state, onEdit }: { clientKey: string; state: NonNullable<Email["sendState"]>; onEdit?: () => void }): JSX.Element {
  const theme = useTheme();
  const [row] = useQuery(commaApi.outboxStatusFor, state === "failed" ? { clientKeys: [clientKey] } : "skip") ?? [];
  const stranded = state === "failed" || state === "notSent";
  const copy = state === "queued" || state === "sending" ? "Sending…"
    : state === "notSent" ? "Not sent. Nothing took it in time."
      : row?.status === "unknown" ? "Not sure this went through. Check Sent in Gmail before sending again."
        : `Couldn't send${row?.error ? `: ${row.error}` : "."}`;
  const run = (change: (client: typeof import("@/lib/identity")["convexClient"]) => Promise<unknown>, fallback: string) =>
    void import("@/lib/identity").then(({ convexClient }) => change(convexClient)).catch((error: unknown) => showToast(messagingCommandError(error, fallback)));
  const discard = () => run((client) => client.mutation(pendingSendsApi.cancelSend, { clientKey }), "Couldn't discard it.");
  const actions = !stranded ? [] : [
    ...(row?.status === "unknown" ? [] : [{ label: "Retry", onPress: () => run((client) => client.mutation(pendingSendsApi.retrySend, { clientKey, retryKey: `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }), "Couldn't send it again.") }]),
    ...(onEdit ? [{ label: "Edit and resend", onPress: () => { onEdit(); discard(); } }] : []),
    { label: "Discard", onPress: discard },
  ];
  return (
    <View style={styles.sendStateRow}>
      <Text style={[styles.sendState, { color: stranded ? theme.destructive : theme.textTertiary }]}>{copy}</Text>
      {actions.map((action) => (
        <Pressable key={action.label} accessibilityRole="button" onPress={action.onPress} hitSlop={6}>
          <Text style={[styles.sendState, styles.sendAction, { color: theme.accent }]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The cleaned HTML in a sandboxed iframe that runs no scripts, its quotes folded, sized to its content as they open. */
function EmailFrame({ html, images, inline, title }: { html: string; images: boolean; inline: Readonly<Record<string, string>>; title: string }): JSX.Element {
  const [height, setHeight] = useState(120);
  return createElement("iframe", {
    title,
    srcDoc: emailDocument(html, { images, inline }),
    sandbox: EMAIL_SANDBOX,
    referrerPolicy: "no-referrer",
    style: { border: 0, width: "100%", height, background: "transparent", borderRadius: 8 },
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
  loading: { paddingTop: 36 },
  visuallyHidden: { height: 1, opacity: 0, overflow: "hidden", position: "absolute", width: 1 },
  // The Messages lens tabs' faces and counts, at the same sizes.
  lensRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  tabs: { gap: 18 },
  tabsPhone: { gap: 22, paddingHorizontal: 20 },
  tabPhone: { paddingBottom: 6 },
  tabLabel: { ...headerFace, fontSize: 14.5, letterSpacing: -0.15, lineHeight: 18 },
  tabLabelPhone: { ...headerFace, fontSize: 26, letterSpacing: -0.5, lineHeight: 32 },
  tabCount: { fontSize: 11.5, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 18, marginLeft: 5 },
  tabCountPhone: { alignSelf: "flex-start", fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 16, marginLeft: 3, marginTop: 2 },
  phoneLenses: { marginHorizontal: -TriageGeometry.listGutter, paddingTop: 8 },
  phoneSearch: { flexDirection: "row", paddingBottom: 6, paddingHorizontal: 8, paddingTop: 14 },
  mailbox: { alignItems: "center", flexDirection: "row", gap: 3 },
  mailboxWide: { borderRadius: 6, marginTop: -3, paddingHorizontal: 6, paddingVertical: 3 },
  mailboxPhone: { borderRadius: 10, height: 40, paddingHorizontal: 10 },
  mailboxText: { fontWeight: "500" },
  listContent: { paddingHorizontal: TriageGeometry.listGutter },
  more: { alignItems: "center", paddingVertical: 14 },
  moreText: { fontSize: 13, fontWeight: "600" },
  empty: { fontSize: 13, paddingHorizontal: 12, paddingTop: 24 },
  readerHeader: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, height: TriageGeometry.threadHeaderHeight },
  readerHeaderWide: { paddingLeft: 22, paddingRight: 12 },
  readerHeaderPhone: { paddingHorizontal: 8 },
  readerSubject: { ...toolbarTitle, flex: 1 },
  readerActions: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: 4 },
  headerIconButton: { borderRadius: 7, height: 30, width: 30 },
  archiveError: { borderBottomWidth: StyleSheet.hairlineWidth, fontSize: 12.5, paddingHorizontal: 22, paddingVertical: 8 },
  column: { alignSelf: "center", maxWidth: READER_WIDTH, width: "100%" },
  sendState: { fontSize: 12.5 },
  sendStateRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 12 },
  sendAction: { fontWeight: "600" },
  cards: { gap: 12, padding: 20 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  cardHead: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  cardFold: { alignItems: "flex-start", flex: 1, flexDirection: "row", gap: 12, minWidth: 0 },
  cardActions: { flexDirection: "row", gap: 2, marginRight: -6, marginTop: -5 },
  cardActionsHidden: { opacity: 0 },
  from: { fontSize: 14, fontWeight: "600" },
  to: { fontSize: 12.5, paddingTop: 2 },
  time: { fontSize: 12, fontVariant: ["tabular-nums"] },
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
  emailFiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { borderRadius: 10, height: 120, overflow: "hidden", width: 160 },
  thumbImage: { height: 120, width: 160 },
});
