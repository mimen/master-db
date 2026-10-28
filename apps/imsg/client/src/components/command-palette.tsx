import { runCommand } from "@/lib/convex-commands";
import { requestSavedView } from "@/lib/palette/saved-views";
import { messagingCommandError } from "@/lib/messaging-api";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatSummary, Contact, Message, StateFilter, TypeFilter } from "@shared/types";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { Springs } from "@/constants/springs";

import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { HOVER_DIM, PRESS_DIM } from "@/constants/theme";
import { api } from "@/lib/api";
import { formatReceiptTime } from "@/lib/format";
import {
  agentChatsSection,
  buildPaletteSections,
  flattenSections,
  type PaletteCommand,
  type PaletteItem,
  type PaletteSection,
} from "@/lib/palette/model";
import { commandQuery, peopleFirstSections, recencyAge, turnAge, type RowAge } from "@/lib/palette-people";
import { splitAroundMatch } from "@/lib/split-match";
import { toggleSettleChat } from "@/hooks/use-triage-actions";
import { openPersonPane } from "@/lib/person-pane";
import { openScheduledPane } from "@/lib/scheduled-pane";
import { openSettingsPane } from "@/lib/settings-pane";
import { selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";
import { useTheme } from "@/hooks/use-theme";
import { useToday } from "@/hooks/use-today";

import { addressesMatch, formatAddress } from "@shared/address";
import { composeSections, type ComposeRow } from "@/lib/palette/compose-rows";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { openAgentChat } from "@/hooks/use-agent-toasts";
import { agentApi, type AgentChatSummary } from "@/lib/agent-api";
import { AGENT_ATTENTION } from "@/lib/inbox-model";
import { useAgentSettings } from "@/lib/settings";
import { localSends, tempMessage } from "@/lib/local-sends";
import { afterPaint } from "@/lib/open-timing";
import { AgentBadge } from "./agent-badge";
import { ChatAvatar, PersonAvatar } from "./avatar";
import { MorphSendButton } from "./motion/morph-send-button";
import {
  PaletteListRow,
  PaletteSectionHeader,
  paletteStyles,
  usePaletteCursor,
} from "./palette/palette-list";

const NO_AGENT_CHATS: readonly AgentChatSummary[] = [];

const COMMAND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  state: "filter-outline",
  type: "people-outline",
  tab: "arrow-forward-outline",
  action: "flash-outline",
  view: "bookmark-outline",
};

export interface CommandPaletteProps {
  /** Recency-ordered universe. */
  chats: ChatSummary[];
  /** "compose" opens straight into the new-message flow (⌘N / compose button). */
  initialMode?: "root" | "compose";
  onClose: () => void;
  /** Full open: mark read + focus composer — palette jump is reply intent. */
  onOpenChat: (chat: ChatSummary) => void;
  /** Lens application — caller also clears the sidebar search (badge semantics). */
  onApplyState: (state: StateFilter) => void;
  onApplyType: (type: TypeFilter) => void;
  onShowHelp: () => void;
}

/**
 * Desktop ⌘K palette (docs/keyboard-design.md Slice 3). The web skin over the
 * headless engine in lib/palette/model.ts — a future mobile sheet reuses the
 * engine, not this component. Both views (search + compose) are built on the
 * shared cursor/row primitives in palette/palette-list.tsx so they behave
 * identically. Esc closes via the global escape ladder; neither view handles
 * it locally.
 */
export function CommandPalette({
  chats,
  initialMode = "root",
  onClose,
  onOpenChat,
  onApplyState,
  onApplyType,
  onShowHelp,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<"root" | "compose">(initialMode);
  if (mode === "compose") {
    return <PaletteCompose onClose={onClose} />;
  }
  return (
    <PaletteRoot
      chats={chats}
      onClose={onClose}
      onOpenChat={onOpenChat}
      onApplyState={onApplyState}
      onApplyType={onApplyType}
      onCompose={() => setMode("compose")}
      onShowHelp={onShowHelp}
    />
  );
}

function PaletteRoot({
  chats,
  onClose,
  onOpenChat,
  onApplyState,
  onApplyType,
  onCompose,
  onShowHelp,
}: {
  chats: ChatSummary[];
  onClose: () => void;
  onOpenChat: (chat: ChatSummary) => void;
  onApplyState: (state: StateFilter) => void;
  onApplyType: (type: TypeFilter) => void;
  onCompose: () => void;
  onShowHelp: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  // One clock per open: ages must not tick while the cursor moves.
  const [now] = useState(() => Date.now());
  const commandFilter = commandQuery(query);
  const searchText = commandFilter === null ? query.trim() : "";

  // Async sources, tagged by query so a late landing never pollutes a newer
  // view (same policy as the sidebar's deep search).
  useEffect(() => {
    setMessages([]);
    setContacts([]);
    if (searchText.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      Promise.all([api.search(searchText).catch(() => []), api.contacts(searchText).catch(() => [])]).then(
        ([messageHits, contactHits]) => {
          if (cancelled) return;
          setMessages(messageHits);
          setContacts(contactHits);
          setSearching(false);
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchText]);

  const people = useMemo(() => peopleFirstSections(chats, now), [chats, now]);
  // The directory's own args, so Convex shares its subscription.
  const { agentPane } = useAgentSettings();
  const agentChats = useQuery(agentApi.listAgentChats, agentPane ? {} : "skip") ?? NO_AGENT_CHATS;
  const sections = useMemo((): PaletteSection[] => {
    if (commandFilter !== null) {
      // ">" asks for commands only: the engine with no conversations yields just its command list.
      return buildPaletteSections({ query: commandFilter, chats: [], messages: [], contacts: [] });
    }
    if (query.trim() === "") {
      const agents = agentChatsSection(chats, agentChats, "");
      return agents ? [...people.sections, agents] : people.sections;
    }
    return buildPaletteSections({ query, chats, messages, contacts, agentChats });
  }, [commandFilter, query, chats, messages, contacts, people, agentChats]);
  const flat = useMemo(() => flattenSections(sections), [sections]);
  const flatRef = useRef(flat);
  flatRef.current = flat;

  const cursor = usePaletteCursor(useMemo(() => flat.map((i) => i.key), [flat]));
  const { reset } = cursor;
  useEffect(() => reset(), [query, reset]);

  const today = useToday();
  const executeCommand = (command: PaletteCommand): void => {
    const id = command.id;
    switch (id.kind) {
      case "state":
        return onApplyState(id.value);
      case "type":
        return onApplyType(id.value);
      case "view":
        requestSavedView(id.value);
        router.navigate("/");
        return;
      case "tab":
        router.navigate(id.value === "contacts" ? "/contacts" : "/");
        return;
      case "action":
        if (id.value === "new-message") return onCompose();
        if (id.value === "scheduled") {
          if (openScheduledPane()) return;
          return void router.push("/scheduled");
        }
        if (id.value === "settings") {
          if (openSettingsPane()) return;
          return void router.push("/settings");
        }
        if (id.value === "regenerate-today") {
          void today.regenerate();
          return onApplyState("today");
        }
        return onShowHelp();
    }
  };

  const execute = (item: PaletteItem): void => {
    // New Message transitions IN PLACE — every other action closes first.
    if (
      item.kind === "command" &&
      item.command.id.kind === "action" &&
      item.command.id.value === "new-message"
    ) {
      return onCompose();
    }
    onClose();
    switch (item.kind) {
      case "command":
        return executeCommand(item.command);
      case "conversation":
      case "group":
        return onOpenChat(item.chat);
      case "message": {
        const m = item.message;
        selectChat({
          guid: m.chatGuid,
          jumpTarget: { guid: m.guid, dateCreated: m.dateCreated },
        });
        return;
      }
      case "agent":
        return openAgentChat(item.chat, item.agent.chatId);
      case "contact":
        // Opens the person card in the desktop right pane (no back target —
        // the palette jump has no originating conversation).
        openPersonPane({ address: item.contact.address, name: item.contact.name, backGuid: "" });
        return;
    }
  };
  const executeRef = useRef(execute);
  executeRef.current = execute;

  // Roving selection: document-level capture so arrows/Enter work while the
  // input keeps focus. Esc is left to the global dispatcher's escape ladder.
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      const items = flatRef.current;
      if (items.length === 0) return;
      if (e.key === "Enter") {
        const item = items[cursorRef.current.indexRef.current];
        if (item) executeRef.current(item);
        return;
      }
      cursorRef.current.move(e.key === "ArrowDown" ? 1 : -1);
    };
    // ⌘E settles the highlighted conversation, not the one open behind the palette. Window capture
    // runs before the global dispatcher's document listener, so stopping it here keeps ⌘E single.
    const onSettle = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== "e" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const item = flatRef.current[cursorRef.current.indexRef.current];
      if (item?.kind !== "conversation" && item?.kind !== "group") return;
      e.preventDefault();
      e.stopPropagation();
      void toggleSettleChat(item.chat);
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onSettle, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onSettle, true);
    };
  }, []);

  const typed = query.trim() !== "";
  const needle = commandFilter ?? query;
  let flatIndex = -1;

  return (
    <PaletteFrame>
      <View style={[styles.inputRow, { borderBottomColor: theme.divider }]}>
        <Ionicons aria-hidden name="search" size={17} color={theme.icon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people and messages, or type a command"
          placeholderTextColor={theme.popTertiary}
          accessibilityLabel="Search or jump to"
          {...({ role: "combobox", "aria-expanded": true, "aria-controls": "command-palette-results" } as object)}
          autoFocus
          style={[styles.input, { color: theme.text }]}
        />
        {query.length > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQuery("")} hitSlop={8}>
            {({ hovered, pressed }) => <Ionicons name="close-circle" size={16} color={hovered || pressed ? theme.text : theme.popTertiary} />}
          </Pressable>
        )}
        <Text aria-hidden style={[paletteStyles.kbd, { borderColor: theme.dividerStrong, color: theme.popTertiary }]}>esc</Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        {...({ id: "command-palette-results", role: "listbox", "aria-label": "Results" } as object)}
      >
        {sections.length === 0 && searchText.length >= 2 && (
          <Text style={[paletteStyles.empty, { color: theme.textSecondary }]}>
            {searching ? "Searching…" : `No results for “${searchText}”`}
          </Text>
        )}
        {sections.map((section) => (
          <Fragment key={section.title}>
            <PaletteSectionHeader title={section.title} />
            {section.items.map((item) => {
              flatIndex += 1;
              const index = flatIndex;
              return (
                <PaletteListRow
                  key={item.key}
                  paletteKey={item.key}
                  selected={index === cursor.selectedIndex}
                  onPress={() => execute(item)}
                  onHover={() => cursor.setSelectedIndex(index)}
                >
                  <PaletteRowContent item={item} needle={needle} age={people.ages.get(item.key)} now={now} />
                </PaletteListRow>
              );
            })}
          </Fragment>
        ))}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: theme.divider }]}>
        <FooterHint keys="↑↓" label="move" />
        <FooterHint keys="↵" label="open" />
        {!typed && <FooterHint keys="⌘E" label="settle" />}
        <View style={{ flex: 1 }} />
        {!typed && <Text style={[styles.footerText, { color: theme.popTertiary }]}>Commands appear as you type</Text>}
      </View>
    </PaletteFrame>
  );
}

function FooterHint({ keys, label }: { keys: string; label: string }) {
  const theme = useTheme();
  return (
    <Text style={[styles.footerText, { color: theme.popTertiary }]}>
      <Text style={[styles.footerKeys, { color: theme.textSecondary }]}>{keys}</Text> {label}
    </Text>
  );
}

/** The palette card: scales 0.98 to 1 and fades in on the snappy spring; Reduce Motion lands it at rest. */
function PaletteFrame({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    shown.value = reduceMotion ? 1 : withSpring(1, Springs.snappy);
  }, [reduceMotion, shown]);
  const entrance = useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.value),
    transform: [{ scale: 0.98 + 0.02 * shown.value }],
  }));
  return (
    <Reanimated.View style={[styles.frame, { backgroundColor: theme.popBg, boxShadow: theme.popShadow }, style, entrance]}>
      {children}
    </Reanimated.View>
  );
}

/** Title text with the query match bolded. */
function Highlighted({ text, needle, color, style }: { text: string; needle: string; color: string; style: StyleProp<TextStyle> }) {
  const split = splitAroundMatch(text, needle);
  return (
    <Text numberOfLines={1} style={[style, { color }]}>
      {split ? (
        <>
          {split.before}
          <Text style={styles.match}>{split.match}</Text>
          {split.after}
        </>
      ) : (
        text
      )}
    </Text>
  );
}

function Age({ age }: { age: RowAge | null | undefined }) {
  const theme = useTheme();
  if (!age) return null;
  return (
    <Text style={[styles.age, age.late ? { color: theme.turn, fontWeight: "600" } : { color: theme.popTertiary }]}>{age.text}</Text>
  );
}

function PaletteRowContent({ item, needle, age, now }: { item: PaletteItem; needle: string; age?: RowAge; now: number }) {
  const theme = useTheme();
  switch (item.kind) {
    case "command":
      return (
        <>
          <View style={[paletteStyles.iconBadge, { backgroundColor: theme.field }]}>
            <Ionicons aria-hidden name={COMMAND_ICONS[item.command.id.kind]} size={14} color={theme.icon} />
          </View>
          <View style={paletteStyles.textCol}>
            <Highlighted text={item.command.title} needle={needle} color={theme.text} style={paletteStyles.title} />
          </View>
          {item.command.shortcut && (
            <Text style={[paletteStyles.kbd, { borderColor: theme.dividerStrong, color: theme.popTertiary }]}>{item.command.shortcut}</Text>
          )}
        </>
      );
    case "conversation":
    case "group": {
      const chat = item.chat;
      const subtitle =
        item.kind === "group"
          ? item.matchedMember
            ? `Includes ${item.matchedMember}`
            : `${chat.participants.length} people`
          : "";
      return (
        <>
          <ChatAvatar chat={chat} size={26} />
          <View style={[paletteStyles.textCol, styles.inline]}>
            <Highlighted text={chat.displayName} needle={needle} color={theme.text} style={[paletteStyles.title, styles.shrink]} />
            {subtitle !== "" && (
              <Text numberOfLines={1} style={[paletteStyles.subtitle, styles.shrink, { color: theme.popTertiary }]}>{subtitle}</Text>
            )}
          </View>
          <Age age={age ?? turnAge(chat, now) ?? recencyAge(chat, now)} />
        </>
      );
    }
    case "message": {
      const m = item.message;
      const sender = m.isFromMe ? "You" : (m.sender?.name ?? m.sender?.address ?? "?");
      return (
        <>
          <PersonAvatar address={m.isFromMe ? null : (m.sender?.address ?? null)} name={sender} size={26} />
          <View style={[paletteStyles.textCol, styles.inline]}>
            <Text numberOfLines={1} style={[paletteStyles.title, styles.noShrink, { color: theme.text }]}>{sender}</Text>
            <Highlighted text={m.text} needle={needle} color={theme.popTertiary} style={[paletteStyles.subtitle, styles.shrink]} />
          </View>
          <Text style={[styles.age, { color: theme.popTertiary }]}>{formatReceiptTime(m.dateCreated)}</Text>
        </>
      );
    }
    case "agent":
      return (
        <>
          <View>
            <ChatAvatar chat={item.chat} size={26} />
            <AgentBadge attention={item.agent.attention} size={14} />
          </View>
          <View style={[paletteStyles.textCol, styles.inline]}>
            <Highlighted text={item.agent.title} needle={needle} color={theme.text} style={[paletteStyles.title, styles.shrink]} />
            <Highlighted text={item.chat.displayName} needle={needle} color={theme.popTertiary} style={[paletteStyles.subtitle, styles.noShrink]} />
          </View>
          <Text style={[styles.age, { color: theme.popTertiary }]}>{AGENT_ATTENTION[item.agent.attention].header}</Text>
        </>
      );
    case "contact":
      return (
        <>
          <PersonAvatar address={item.contact.address} name={item.contact.name} size={26} />
          <View style={[paletteStyles.textCol, styles.inline]}>
            <Highlighted text={item.contact.name} needle={needle} color={theme.text} style={[paletteStyles.title, styles.noShrink]} />
            <Text numberOfLines={1} style={[paletteStyles.subtitle, styles.shrink, { color: theme.popTertiary }]}>{item.contact.address}</Text>
          </View>
          <Text style={[styles.age, { color: theme.popTertiary }]}>Contact card</Text>
        </>
      );
  }
}

/** Palette-styled new-message flow: recipient search with chips, then the
 * first message. Built on the same cursor/row primitives as the root view. */
function PaletteCompose({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const [recipients, setRecipients] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ needle: string; contacts: Contact[] }>({ needle: "", contacts: [] });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const recipientInputRef = useRef<TextInput>(null);
  const messageInputRef = useRef<TextInput>(null);
  const directory = useChatDirectory();

  const needle = query.trim();
  // The last answer stays on screen while the next one loads, so rows never blank between keys;
  // the directory's own matches fill in instantly in the meantime.
  useEffect(() => {
    if (needle.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .contacts(needle)
        .then((found) => {
          if (!cancelled) setResults({ needle, contacts: found });
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [needle]);
  const searching = needle.length >= 2 && results.needle !== needle;

  const addRecipient = (c: Contact): void => {
    setRecipients((cur) => (cur.some((x) => addressesMatch(x.address, c.address)) ? cur : [...cur, c]));
    setQuery("");
    recipientInputRef.current?.focus();
  };

  // Same Airtable augmentation as the Contacts surfaces: unlinked humans can
  // be added, then land as a recipient.
  const { results: airtableResults, add: addAirtableContact, addingId } = useAirtableSearch(
    needle,
    (_personId, human) => {
      const address = human.phone ?? human.email;
      if (address) addRecipient({ address, name: human.display_name });
    },
  );

  const sections = useMemo(() => composeSections({
    query,
    recipients,
    directory: directory ?? [],
    contacts: needle.length >= 2 ? results.contacts : [],
    airtable: airtableResults,
  }), [query, recipients, directory, needle, results.contacts, airtableResults]);
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const cursor = usePaletteCursor(useMemo(() => rows.map((r) => r.key), [rows]));
  const { reset } = cursor;
  useEffect(() => reset(), [needle, reset]);

  const [only] = recipients;
  const existing = recipients.length === 1 && only ? directory?.find((chat) => !chat.isGroup && chat.guid.startsWith("iMessage;") &&
    chat.participants.length === 1 && addressesMatch(chat.participants[0]?.address ?? "", only.address)) : undefined;
  const send = (): void => {
    const body = text.trim();
    if (recipients.length === 0 || body === "" || sending) return;
    setSending(true);
    // createChat lands one recipient in their iMessage conversation; when that already exists,
    // the message shows there on the click, as a composer send does.
    const temp = existing ? tempMessage(existing.guid, body) : null;
    if (existing && temp) {
      localSends.upsert(existing.guid, temp);
      // Mounting the thread costs a long frame; the Sending ring paints first, on the frame of the click.
      afterPaint(() => {
        onClose();
        selectChat({ guid: existing.guid, name: existing.displayName });
      });
    }
    runCommand(null, { kind: "createChat", addresses: recipients.map((c) => c.address), text: body })
      .then(({ chatGuid, message }) => {
        if (existing && temp && chatGuid === existing.guid) return localSends.settle(chatGuid, temp.guid, message);
        if (existing && temp) localSends.retain(existing.guid, (m) => m.guid !== temp.guid);
        onClose();
        selectChat({ guid: chatGuid });
      })
      .catch((e: unknown) => {
        if (existing && temp) localSends.settle(existing.guid, temp.guid, { ...temp, pending: false, failed: true });
        const detail =
          e instanceof Error ? /"error"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] : undefined;
        showToast(messagingCommandError(e, detail ? `Couldn't start: ${detail.slice(0, 120)}` : e instanceof Error ? `Couldn't start: ${e.message.slice(0, 120)}` : "Couldn't start the conversation"));
      })
      .finally(() => setSending(false));
  };

  const choose = (row: ComposeRow): void => {
    if (row.kind === "airtable") void addAirtableContact(row.human);
    else addRecipient(row.contact);
  };

  // Keyboard: arrows rove results; Enter adds the selected row from the To field and sends from
  // the message field (⇧Enter is a new line); Backspace on an empty To field pops the last chip.
  // Esc stays with the global ladder.
  const stateRef = useRef({ query, recipients, send, choose });
  stateRef.current = { query, recipients, send, choose };
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = stateRef.current;
      const inMessage =
        typeof document !== "undefined" &&
        document.activeElement === (messageInputRef.current as unknown as Element | null);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (inMessage || rowsRef.current.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        cursorRef.current.move(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === "Enter") {
        if (inMessage && e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (inMessage) return st.send();
        const row = rowsRef.current[cursorRef.current.indexRef.current];
        if (row && st.query.trim() !== "") return st.choose(row);
        if (st.query.trim() === "" && st.recipients.length > 0) messageInputRef.current?.focus();
        else if (row) st.choose(row);
        return;
      }
      if (e.key === "Backspace" && !inMessage && st.query === "" && st.recipients.length > 0) {
        setRecipients((cur) => cur.slice(0, -1));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const canSend = recipients.length > 0 && text.trim().length > 0 && !sending;
  const inTo = query.trim() !== "" || recipients.length === 0;
  let flatIndex = -1;

  return (
    <PaletteFrame style={styles.composeFrame}>
      <View style={[styles.composeHeader, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.composeTitle, { color: theme.text }]}>New message</Text>
        <Text aria-hidden style={[paletteStyles.kbd, { borderColor: theme.dividerStrong, color: theme.popTertiary }]}>esc</Text>
      </View>
      <View style={[styles.composeToRow, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.composeToLabel, { color: theme.textSecondary }]}>To</Text>
        <View style={styles.chipWrap}>
          {recipients.map((contact) => (
            <Pressable
              key={contact.address}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${contact.name}`}
              onPress={() => setRecipients((cur) => cur.filter((c) => c.address !== contact.address))}
              style={({ hovered, pressed }) => [styles.chip, { backgroundColor: theme.accent }, hovered && !pressed && { opacity: HOVER_DIM }, pressed && { opacity: PRESS_DIM }]}
            >
              <Text numberOfLines={1} style={[styles.chipText, { color: theme.onAccent }]}>{contact.name === contact.address ? formatAddress(contact.address) : contact.name}</Text>
              <Ionicons name="close" size={13} color={theme.onAccent} />
            </Pressable>
          ))}
          <TextInput
            ref={recipientInputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={recipients.length === 0 ? "Name, number, or email" : "Add another"}
            placeholderTextColor={theme.popTertiary}
            accessibilityLabel="To"
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={[styles.input, styles.composeToInput, { color: theme.text }]}
          />
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent} style={styles.composeResults}>
        {sections.map((section) => (
          <Fragment key={section.title}>
            <PaletteSectionHeader title={section.title} />
            {section.rows.map((row) => {
              flatIndex += 1;
              const index = flatIndex;
              const selected = index === cursor.selectedIndex;
              const name = row.kind === "airtable" ? row.human.display_name : row.contact.name;
              const address = row.kind === "airtable" ? row.human.phone ?? row.human.email ?? null : row.contact.address;
              const adding = row.kind === "airtable" && addingId === row.human.record_id;
              return (
                <PaletteListRow
                  key={row.key}
                  paletteKey={row.key}
                  selected={selected}
                  disabled={adding}
                  onPress={() => choose(row)}
                  onHover={() => cursor.setSelectedIndex(index)}
                >
                  {row.kind === "raw" ? (
                    <View style={[paletteStyles.iconBadge, { backgroundColor: theme.field }]}>
                      <Ionicons aria-hidden name={address?.includes("@") ? "mail-outline" : "call-outline"} size={14} color={theme.icon} />
                    </View>
                  ) : (
                    <PersonAvatar address={address ?? name} name={name} size={28} />
                  )}
                  <View style={paletteStyles.textCol}>
                    <Text numberOfLines={1} style={[paletteStyles.title, { color: theme.text }]}>
                      {row.kind === "raw" ? formatAddress(row.contact.address) : name}
                    </Text>
                    {row.kind !== "raw" && address && formatAddress(address) !== name ? (
                      <Text numberOfLines={1} style={[paletteStyles.subtitle, { color: theme.textSecondary }]}>{formatAddress(address)}</Text>
                    ) : null}
                  </View>
                  {adding ? <Text style={[paletteStyles.hint, { color: theme.textSecondary }]}>Adding…</Text> : null}
                </PaletteListRow>
              );
            })}
          </Fragment>
        ))}
        {rows.length === 0 && needle.length >= 2 && (
          <Text style={[paletteStyles.empty, { color: theme.textSecondary }]}>
            {searching ? "Searching…" : `No one matches “${needle}”. Type a full number or email to start a new conversation.`}
          </Text>
        )}
        {rows.length === 0 && needle.length < 2 && recipients.length > 0 && (
          <Text style={[paletteStyles.empty, { color: theme.textSecondary }]}>
            {existing ? `This continues your conversation with ${existing.displayName}.` : "Add another person, or write the first message below."}
          </Text>
        )}
      </ScrollView>
      <View style={[styles.composeBar, { borderTopColor: theme.divider }]}>
        <TextInput
          ref={messageInputRef}
          value={text}
          onChangeText={setText}
          placeholder={recipients.length === 0 ? "Add someone first" : "Message"}
          placeholderTextColor={theme.popTertiary}
          accessibilityLabel="Message"
          multiline
          numberOfLines={1}
          style={[styles.composeMessageInput, { borderColor: theme.dividerStrong, color: theme.text }]}
        />
        <MorphSendButton status={sending ? "sending" : "idle"} disabled={!canSend && !sending} onPress={send} />
      </View>
      <View style={[styles.footer, { borderTopColor: theme.divider }]}>
        <FooterHint keys="↑↓" label="move" />
        <FooterHint keys="↵" label={inTo ? "add" : "send"} />
        <FooterHint keys="⇧↵" label="new line" />
      </View>
    </PaletteFrame>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 16,
    flexShrink: 1,
    maxHeight: "100%",
    overflow: "hidden",
  },
  inputRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  listContent: {
    paddingBottom: 8,
    paddingTop: 6,
  },
  inline: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
  },
  shrink: {
    flexShrink: 1,
  },
  noShrink: {
    flexShrink: 0,
  },
  match: {
    fontWeight: "700",
  },
  age: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  footer: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 16,
    height: 38,
    paddingHorizontal: 18,
  },
  footerText: {
    fontSize: 11.5,
  },
  footerKeys: {
    fontWeight: "600",
  },
  composeFrame: {
    height: 480,
  },
  composeHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 44,
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  composeTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  composeToRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  composeToLabel: {
    fontSize: 15,
  },
  composeResults: {
    flex: 1,
  },
  chipWrap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    alignItems: "center",
    borderRadius: 13,
    flexDirection: "row",
    gap: 4,
    height: 26,
    maxWidth: 220,
    paddingHorizontal: 10,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  composeToInput: {
    minWidth: 160,
    paddingVertical: 4,
  },
  composeBar: {
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  composeMessageInput: {
    borderRadius: 17,
    borderWidth: 1,
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 34,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
});
