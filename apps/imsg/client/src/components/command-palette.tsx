import { requestSavedView } from "@/lib/palette/saved-views";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatSummary, Contact, StateFilter, TypeFilter } from "@shared/types";
import { useQuery } from "convex/react";
import { router } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { Springs } from "@/constants/springs";

import { api, type SearchHit } from "@/lib/api";
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
import { accountsApi } from "@/lib/convex-api";
import { runCommand as runKeyboardCommand } from "@/lib/keyboard/controller";
import { openPersonPane } from "@/lib/person-pane";
import { openScheduledPane } from "@/lib/scheduled-pane";
import { openSettingsPane } from "@/lib/settings-pane";
import { selectChat } from "@/lib/selection";
import { useTheme } from "@/hooks/use-theme";
import { useToday } from "@/hooks/use-today";

import { formatAddress } from "@shared/address";
import { conversationRoute } from "@shared/imessage";
import { platformBadge } from "@shared/platform-profile";
import { useConversation } from "@/hooks/use-chat-directory";
import { openAgentChat } from "@/hooks/use-agent-toasts";
import { agentApi, type AgentChatSummary } from "@/lib/agent-api";
import { AGENT_ATTENTION } from "@/lib/inbox-model";
import { useAgentSettings } from "@/lib/settings";
import { ChatAvatar, PersonAvatar, type AvatarSource } from "./avatar";
import {
  PaletteListRow,
  PaletteSectionHeader,
  paletteStyles,
  usePaletteCursor,
} from "./palette/palette-list";
import { workspacePath } from "@/lib/workspaces";

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
 * engine, not this component. Its rows are the shared cursor/row primitives
 * in palette/palette-list.tsx, which the new-message sheet also uses. Esc
 * closes via the global escape ladder. New message opens the compose sheet.
 */
export function CommandPalette({
  chats,
  onClose,
  onOpenChat,
  onApplyState,
  onApplyType,
  onShowHelp,
}: CommandPaletteProps) {
  return (
    <PaletteRoot
      chats={chats}
      onClose={onClose}
      onOpenChat={onOpenChat}
      onApplyState={onApplyState}
      onApplyType={onApplyType}
      onCompose={() => {
        onClose();
        router.push("/new-chat");
      }}
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
  const [messages, setMessages] = useState<SearchHit[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  // One clock per open: ages must not tick while the cursor moves.
  const [now] = useState(() => Date.now());
  const accounts = useQuery(accountsApi.listAccounts, {});
  const personalMail = useMemo(() => new Set((accounts ?? []).flatMap((account) => account.gmailApp === "personal" ? [account._id as string] : [])), [accounts]);
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
        router.navigate(workspacePath(id.value));
        return;
      case "action":
        if (id.value === "new-message") return onCompose();
        if (id.value === "later") return void runKeyboardCommand("conversation.later", "palette");
        if (id.value === "follow-up") return void runKeyboardCommand("conversation.followUp", "palette");
        if (id.value === "scheduled") {
          if (openScheduledPane()) return;
          return void router.push("/scheduled");
        }
        if (id.value === "settings") {
          if (openSettingsPane()) return;
          return void router.push("/settings");
        }
        if (id.value === "update-today" || id.value === "regenerate-today") {
          void today.request(id.value === "update-today" ? "update" : "fresh");
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
          conversationId: m.conversationId,
          jumpTarget: { guid: m.guid, dateCreated: m.dateCreated },
        });
        return;
      }
      case "agent":
        return openAgentChat(item.chat, item.agent.chatId);
      case "contact":
        // Opens the person card in the desktop right pane (no back target —
        // the palette jump has no originating conversation).
        openPersonPane({ address: item.contact.address, name: item.contact.name });
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
    // ⌘E settles the highlighted conversation, never the one open behind the palette: on any other row it does
    // nothing. Window capture runs before the global dispatcher's document listener, so stopping it here keeps ⌘E single.
    const onSettle = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== "e" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const item = flatRef.current[cursorRef.current.indexRef.current];
      if (item?.kind === "conversation" || item?.kind === "group") void toggleSettleChat(item.chat);
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
                  <PaletteRowContent item={item} needle={needle} age={people.ages.get(item.key)} now={now} personalMail={personalMail} />
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

/** A message hit: its sender, or the conversation's name when the sender is unresolved, then the snippet. */
function MessageHitContent({ hit: m, needle }: { hit: SearchHit; needle: string }) {
  const theme = useTheme();
  const chat = useConversation(m.conversationId);
  const sender = m.isFromMe ? "You" : m.sender?.name ?? null;
  const title = sender ?? chat?.displayName ?? (m.sender?.address ? formatAddress(m.sender.address) : "Message");
  return (
    <>
      {sender === null && chat ? <ChatAvatar chat={chat} size={26} />
        : <PersonAvatar address={m.isFromMe ? null : (m.sender?.address ?? null)} name={title} size={26} />}
      <View style={[paletteStyles.textCol, styles.inline]}>
        <Text numberOfLines={1} style={[paletteStyles.title, styles.noShrink, { color: theme.text }]}>{title}</Text>
        <Highlighted text={m.text} needle={needle} color={theme.popTertiary} style={[paletteStyles.subtitle, styles.shrink]} />
      </View>
      <Text style={[styles.age, { color: theme.popTertiary }]}>{formatReceiptTime(m.dateCreated)}</Text>
    </>
  );
}

function sourceOf(chat: ChatSummary, personalMail: ReadonlySet<string>): AvatarSource {
  return { badge: platformBadge(conversationRoute(chat)), personal: chat.route.accountId !== null && personalMail.has(chat.route.accountId) };
}

function PaletteRowContent({ item, needle, age, now, personalMail }: { item: PaletteItem; needle: string; age?: RowAge; now: number; personalMail: ReadonlySet<string> }) {
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
          <ChatAvatar chat={chat} size={26} source={sourceOf(chat, personalMail)} />
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
    case "message":
      return <MessageHitContent hit={item.message} needle={needle} />;
    case "agent":
      return (
        <>
          <ChatAvatar chat={item.chat} size={26} source={sourceOf(item.chat, personalMail)} />
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
});
