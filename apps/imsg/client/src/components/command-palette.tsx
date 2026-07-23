import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, Contact, Message, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "@/lib/api";
import { formatListTimestamp, initials } from "@/lib/format";
import {
  buildPaletteSections,
  flattenSections,
  type PaletteCommand,
  type PaletteItem,
} from "@/lib/palette/model";
import { openPersonPane } from "@/lib/person-pane";
import { selectChat } from "@/lib/selection";
import { useTheme } from "@/hooks/use-theme";

import { ChatAvatar } from "./avatar";

const COMMAND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  state: "funnel-outline",
  type: "funnel-outline",
  tab: "arrow-forward-outline",
  action: "flash-outline",
};

export interface CommandPaletteProps {
  /** Recency-ordered universe (archived included). */
  chats: ChatSummary[];
  onClose: () => void;
  /** Full open: mark read + focus composer — palette jump is reply intent. */
  onOpenChat: (chat: ChatSummary) => void;
  /** Lens application — caller also clears the sidebar search (badge semantics). */
  onApplyState: (state: StateFilter) => void;
  onApplyType: (type: TypeFilter) => void;
  onNewMessage: () => void;
  onShowHelp: () => void;
}

/**
 * Desktop ⌘K palette (docs/keyboard-design.md Slice 3). The web skin over the
 * headless engine in lib/palette/model.ts — a future mobile sheet reuses the
 * engine, not this component. Roving ↑↓/Enter selection; Esc closes via the
 * global escape ladder (this component deliberately does not handle Esc).
 */
export function CommandPalette({
  chats,
  onClose,
  onOpenChat,
  onApplyState,
  onApplyType,
  onNewMessage,
  onShowHelp,
}: CommandPaletteProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);

  // Async sources, tagged by query so a late landing never pollutes a newer
  // view (same policy as the sidebar's deep search).
  useEffect(() => {
    const q = query.trim();
    setMessages([]);
    setContacts([]);
    if (q.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      Promise.all([
        api.search(q).catch(() => []),
        api.contacts(q).catch(() => []),
      ]).then(([messageHits, contactHits]) => {
        if (cancelled) return;
        setMessages(messageHits);
        setContacts(contactHits);
        setSearching(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const sections = useMemo(
    () => buildPaletteSections({ query, chats, messages, contacts }),
    [query, chats, messages, contacts],
  );
  const flat = useMemo(() => flattenSections(sections), [sections]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);
  // Live data churn (SSE chat refreshes) rebuilds sections constantly; keep
  // the cursor where it is and only clamp if the list shrank under it.
  useEffect(() => {
    if (flat.length > 0 && selectedIndex > flat.length - 1) {
      setSelectedIndex(flat.length - 1);
    }
  }, [flat.length, selectedIndex]);

  const execute = (item: PaletteItem): void => {
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
      case "contact":
        // Opens the person card in the desktop right pane (no back target —
        // the palette jump has no originating conversation).
        openPersonPane({ address: item.contact.address, name: item.contact.name, backGuid: "" });
        return;
    }
  };

  const executeCommand = (command: PaletteCommand): void => {
    const id = command.id;
    switch (id.kind) {
      case "state":
        return onApplyState(id.value);
      case "type":
        return onApplyType(id.value);
      case "tab":
        router.navigate(id.value === "contacts" ? "/contacts" : "/");
        return;
      case "action":
        return id.value === "new-message" ? onNewMessage() : onShowHelp();
    }
  };

  // Roving selection: document-level capture so arrows/Enter work while the
  // input keeps focus. Esc is left to the global dispatcher's escape ladder.
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const indexRef = useRef(selectedIndex);
  indexRef.current = selectedIndex;
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      const items = flatRef.current;
      if (items.length === 0) return;
      if (e.key === "Enter") {
        const item = items[indexRef.current];
        if (item) executeRef.current(item);
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setSelectedIndex(Math.max(0, Math.min(items.length - 1, indexRef.current + delta)));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Keep the selected row visible: track each row's frame, scroll minimally.
  const scrollRef = useRef<ScrollView>(null);
  const rowFrames = useRef(new Map<string, { y: number; height: number }>());
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  useEffect(() => {
    const item = flatRef.current[selectedIndex];
    if (!item) return;
    const frame = rowFrames.current.get(item.key);
    if (!frame || viewportH.current <= 0) return;
    const top = scrollY.current;
    const bottom = top + viewportH.current;
    if (frame.y < top + 8) {
      scrollRef.current?.scrollTo({ y: Math.max(0, frame.y - 34), animated: false });
    } else if (frame.y + frame.height > bottom - 8) {
      scrollRef.current?.scrollTo({
        y: frame.y + frame.height - viewportH.current + 8,
        animated: false,
      });
    }
    // Cursor moves only — data churn must never trigger a programmatic scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  let flatIndex = -1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.inputRow, { borderBottomColor: theme.divider }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search or jump to…"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          style={[styles.input, { color: theme.text }]}
        />
        {query.length > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
      >
        {sections.length === 0 && query.trim().length >= 2 && (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {searching ? "Searching…" : "No results"}
          </Text>
        )}
        {sections.map((section) => (
          <Fragment key={section.title}>
            <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>{section.title}</Text>
            {section.items.map((item) => {
              flatIndex += 1;
              const index = flatIndex;
              const selected = index === selectedIndex;
              return (
                <Pressable
                  key={item.key}
                  onLayout={(e) => {
                    rowFrames.current.set(item.key, {
                      y: e.nativeEvent.layout.y,
                      height: e.nativeEvent.layout.height,
                    });
                  }}
                  onPress={() => execute(item)}
                  onHoverIn={() => setSelectedIndex(index)}
                  style={[styles.row, selected && { backgroundColor: theme.backgroundSelected }]}
                >
                  <PaletteRow item={item} />
                  {selected && (
                    <Text style={[styles.enterHint, { color: theme.textSecondary }]}>↵</Text>
                  )}
                </Pressable>
              );
            })}
          </Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

function PaletteRow({ item }: { item: PaletteItem }) {
  const theme = useTheme();
  switch (item.kind) {
    case "command":
      return (
        <>
          <View style={[styles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name={COMMAND_ICONS[item.command.id.kind]} size={16} color={theme.accent} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{item.command.title}</Text>
          <Text style={[styles.hint, { color: theme.textSecondary }]}>{item.command.hint}</Text>
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
          : (chat.lastMessage?.text ?? "");
      return (
        <>
          <ChatAvatar chat={chat} size={30} />
          <View style={styles.textCol}>
            <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
              {chat.displayName}
            </Text>
            {subtitle !== "" && (
              <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSecondary }]}>
                {subtitle}
              </Text>
            )}
          </View>
          {chat.flags.archived && (
            <Ionicons name="archive-outline" size={14} color={theme.textSecondary} />
          )}
        </>
      );
    }
    case "message": {
      const m = item.message;
      return (
        <>
          <View style={[styles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="chatbubble-outline" size={15} color={theme.textSecondary} />
          </View>
          <View style={styles.textCol}>
            <View style={styles.messageTop}>
              <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
                {m.isFromMe ? "You" : (m.sender?.name ?? m.sender?.address ?? "?")}
              </Text>
              <Text style={[styles.hint, { color: theme.textSecondary }]}>
                {formatListTimestamp(m.dateCreated)}
              </Text>
            </View>
            <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSecondary }]}>
              {m.text}
            </Text>
          </View>
        </>
      );
    }
    case "contact":
      return (
        <>
          <View style={[styles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "600" }}>
              {initials(item.contact.name)}
            </Text>
          </View>
          <View style={styles.textCol}>
            <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
              {item.contact.name}
            </Text>
            <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSecondary }]}>
              {item.contact.address}
            </Text>
          </View>
          <Text style={[styles.hint, { color: theme.textSecondary }]}>Contact card</Text>
        </>
      );
  }
}

const styles = StyleSheet.create({
  inputRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  input: {
    flex: 1,
    fontSize: 17,
  },
  listContent: {
    paddingBottom: 10,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    paddingBottom: 3,
    paddingHorizontal: 16,
    paddingTop: 12,
    textTransform: "uppercase",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  iconBadge: {
    alignItems: "center",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: "500",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 1,
  },
  messageTop: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  hint: {
    fontSize: 12,
  },
  enterHint: {
    fontSize: 13,
  },
  empty: {
    fontSize: 15,
    marginTop: 40,
    textAlign: "center",
  },
});
