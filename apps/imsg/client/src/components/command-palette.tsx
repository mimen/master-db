import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, Contact, Message, StateFilter, TypeFilter } from "@shared/types";
import { router } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAirtableSearch } from "@/hooks/use-airtable-search";
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
import { showToast } from "@/lib/toast";
import { useTheme } from "@/hooks/use-theme";
import type { AirtableHumanRow } from "@/lib/identity";

import { ChatAvatar } from "./avatar";
import {
  PaletteListRow,
  PaletteSectionHeader,
  paletteStyles,
  usePaletteCursor,
} from "./palette/palette-list";

const COMMAND_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  state: "funnel-outline",
  type: "funnel-outline",
  tab: "arrow-forward-outline",
  action: "flash-outline",
};

export interface CommandPaletteProps {
  /** Recency-ordered universe (archived included). */
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
      Promise.all([api.search(q).catch(() => []), api.contacts(q).catch(() => [])]).then(
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
  }, [query]);

  const sections = useMemo(
    () => buildPaletteSections({ query, chats, messages, contacts }),
    [query, chats, messages, contacts],
  );
  const flat = useMemo(() => flattenSections(sections), [sections]);
  const flatRef = useRef(flat);
  flatRef.current = flat;

  const cursor = usePaletteCursor(useMemo(() => flat.map((i) => i.key), [flat]));
  const { reset } = cursor;
  useEffect(() => reset(), [query, reset]);

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
        return id.value === "new-message" ? onCompose() : onShowHelp();
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
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

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
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent}>
        {sections.length === 0 && query.trim().length >= 2 && (
          <Text style={[paletteStyles.empty, { color: theme.textSecondary }]}>
            {searching ? "Searching…" : "No results"}
          </Text>
        )}
        {sections.map((section) => (
          <Fragment key={section.title}>
            <PaletteSectionHeader title={section.title} />
            {section.items.map((item) => {
              flatIndex += 1;
              const index = flatIndex;
              const selected = index === cursor.selectedIndex;
              return (
                <PaletteListRow
                  key={item.key}
                  paletteKey={item.key}
                  selected={selected}
                  onPress={() => execute(item)}
                  onHover={() => cursor.setSelectedIndex(index)}
                >
                  <PaletteRowContent item={item} />
                  {selected && (
                    <Text style={[paletteStyles.enterHint, { color: theme.textSecondary }]}>↵</Text>
                  )}
                </PaletteListRow>
              );
            })}
          </Fragment>
        ))}
      </ScrollView>
    </View>
  );
}

function PaletteRowContent({ item }: { item: PaletteItem }) {
  const theme = useTheme();
  switch (item.kind) {
    case "command":
      return (
        <>
          <View style={[paletteStyles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name={COMMAND_ICONS[item.command.id.kind]} size={16} color={theme.accent} />
          </View>
          <Text style={[paletteStyles.title, { color: theme.text }]}>{item.command.title}</Text>
          <Text style={[paletteStyles.hint, { color: theme.textSecondary }]}>{item.command.hint}</Text>
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
          <View style={paletteStyles.textCol}>
            <Text numberOfLines={1} style={[paletteStyles.title, { color: theme.text }]}>
              {chat.displayName}
            </Text>
            {subtitle !== "" && (
              <Text numberOfLines={1} style={[paletteStyles.subtitle, { color: theme.textSecondary }]}>
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
          <View style={[paletteStyles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="chatbubble-outline" size={15} color={theme.textSecondary} />
          </View>
          <View style={paletteStyles.textCol}>
            <View style={styles.messageTop}>
              <Text numberOfLines={1} style={[paletteStyles.title, { color: theme.text }]}>
                {m.isFromMe ? "You" : (m.sender?.name ?? m.sender?.address ?? "?")}
              </Text>
              <Text style={[paletteStyles.hint, { color: theme.textSecondary }]}>
                {formatListTimestamp(m.dateCreated)}
              </Text>
            </View>
            <Text numberOfLines={1} style={[paletteStyles.subtitle, { color: theme.textSecondary }]}>
              {m.text}
            </Text>
          </View>
        </>
      );
    }
    case "contact":
      return (
        <>
          <View style={[paletteStyles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "600" }}>
              {initials(item.contact.name)}
            </Text>
          </View>
          <View style={paletteStyles.textCol}>
            <Text numberOfLines={1} style={[paletteStyles.title, { color: theme.text }]}>
              {item.contact.name}
            </Text>
            <Text numberOfLines={1} style={[paletteStyles.subtitle, { color: theme.textSecondary }]}>
              {item.contact.address}
            </Text>
          </View>
          <Text style={[paletteStyles.hint, { color: theme.textSecondary }]}>Contact card</Text>
        </>
      );
  }
}

type ComposeRow =
  | { kind: "contact"; key: string; contact: Contact }
  | { kind: "airtable"; key: string; human: AirtableHumanRow };

/** Palette-styled new-message flow: recipient search with chips, then the
 * first message — replaces the old desktop NewChatContent overlay. Built on
 * the same cursor/row primitives as the root view. */
function PaletteCompose({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const [recipients, setRecipients] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const recipientInputRef = useRef<TextInput>(null);
  const messageInputRef = useRef<TextInput>(null);

  const needle = query.trim();
  useEffect(() => {
    setResults([]);
    if (needle.length < 2) return;
    // Cancellation is load-bearing: an in-flight request must not land after
    // a clear and repopulate the list with stale rows.
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .contacts(needle)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [needle]);

  const addRecipient = (c: Contact): void => {
    setRecipients((cur) => (cur.some((x) => x.address === c.address) ? cur : [...cur, c]));
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

  // One row per underlying address: the directory can hold duplicate entries
  // for the same number, and an Airtable human may duplicate a directory hit.
  const rows: ComposeRow[] = useMemo(() => {
    const normalize = (address: string): string =>
      address.replace(/[^a-z0-9@+]/gi, "").toLowerCase();
    const seen = new Set(recipients.map((r) => normalize(r.address)));
    const out: ComposeRow[] = [];
    for (const c of results) {
      const norm = normalize(c.address);
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({ kind: "contact", key: `c-${norm}`, contact: c });
    }
    for (const h of airtableResults) {
      const addr = h.phone ?? h.email;
      if (addr && seen.has(normalize(addr))) continue;
      out.push({ kind: "airtable", key: `at-${h.record_id}`, human: h });
    }
    return out;
  }, [results, airtableResults, recipients]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const cursor = usePaletteCursor(useMemo(() => rows.map((r) => r.key), [rows]));
  const { reset } = cursor;
  useEffect(() => reset(), [needle, reset]);

  const send = (): void => {
    const body = text.trim();
    if (recipients.length === 0 || body === "" || sending) return;
    setSending(true);
    api
      .newChat({ addresses: recipients.map((c) => c.address), text: body })
      .then(({ chatGuid }) => {
        onClose();
        selectChat({ guid: chatGuid });
      })
      .catch((e: unknown) => {
        const detail =
          e instanceof Error ? /"error"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] : undefined;
        showToast(detail ? `Couldn't start: ${detail.slice(0, 120)}` : "Couldn't start the conversation");
      })
      .finally(() => setSending(false));
  };

  // Keyboard: arrows rove results; Enter adds the selected result (or a raw
  // address) from the To field, sends from the message field; Backspace on an
  // empty To field pops the last chip. Esc stays with the global ladder.
  const stateRef = useRef({ query, recipients, send });
  stateRef.current = { query, recipients, send };
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const addAirtableRef = useRef(addAirtableContact);
  addAirtableRef.current = addAirtableContact;
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
        e.preventDefault();
        e.stopPropagation();
        if (inMessage) return st.send();
        const row = rowsRef.current[cursorRef.current.indexRef.current];
        if (row?.kind === "contact") return addRecipient(row.contact);
        if (row?.kind === "airtable") return void addAirtableRef.current(row.human);
        const raw = st.query.trim();
        // No matches — treat the raw text as an address (number/email).
        if (raw !== "" && rowsRef.current.length === 0) addRecipient({ address: raw, name: raw });
        else if (raw === "" && st.recipients.length > 0) messageInputRef.current?.focus();
        return;
      }
      if (e.key === "Backspace" && !inMessage && st.query === "" && st.recipients.length > 0) {
        setRecipients((cur) => cur.slice(0, -1));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSend = recipients.length > 0 && text.trim().length > 0 && !sending;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.inputRow, styles.composeToRow, { borderBottomColor: theme.divider }]}>
        <Text style={[paletteStyles.hint, { color: theme.textSecondary }]}>To:</Text>
        <View style={styles.chipWrap}>
          {recipients.map((contact) => (
            <Pressable
              key={contact.address}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${contact.name}`}
              onPress={() => setRecipients((cur) => cur.filter((c) => c.address !== contact.address))}
              style={[styles.chip, { backgroundColor: theme.accent }]}
            >
              <Text style={{ color: theme.onAccent, fontSize: 13 }}>{contact.name}</Text>
              <Ionicons name="close" size={13} color={theme.onAccent} />
            </Pressable>
          ))}
          <TextInput
            ref={recipientInputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={recipients.length === 0 ? "Name, number, or email" : ""}
            placeholderTextColor={theme.textSecondary}
            autoFocus
            style={[styles.input, styles.composeToInput, { color: theme.text }]}
          />
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent} style={{ flex: 1 }}>
        {rows.length > 0 && <PaletteSectionHeader title="Contacts" />}
        {rows.map((row, index) => {
          const selected = index === cursor.selectedIndex;
          if (row.kind === "airtable") {
            const adding = addingId === row.human.record_id;
            return (
              <PaletteListRow
                key={row.key}
                paletteKey={row.key}
                selected={selected}
                disabled={adding}
                onPress={() => void addAirtableContact(row.human)}
                onHover={() => cursor.setSelectedIndex(index)}
              >
                <View style={[paletteStyles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
                  <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "600" }}>
                    {initials(row.human.display_name)}
                  </Text>
                </View>
                <Text style={[paletteStyles.title, { color: theme.text, flex: 1 }]}>
                  {row.human.display_name}
                </Text>
                <Text style={[paletteStyles.hint, { color: theme.textSecondary }]}>
                  {adding ? "Adding…" : "From Airtable"}
                </Text>
              </PaletteListRow>
            );
          }
          return (
            <PaletteListRow
              key={row.key}
              paletteKey={row.key}
              selected={selected}
              onPress={() => addRecipient(row.contact)}
              onHover={() => cursor.setSelectedIndex(index)}
            >
              <View style={[paletteStyles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
                <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "600" }}>
                  {initials(row.contact.name)}
                </Text>
              </View>
              <View style={paletteStyles.textCol}>
                <Text numberOfLines={1} style={[paletteStyles.title, { color: theme.text }]}>
                  {row.contact.name}
                </Text>
                <Text numberOfLines={1} style={[paletteStyles.subtitle, { color: theme.textSecondary }]}>
                  {row.contact.address}
                </Text>
              </View>
              {selected && <Text style={[paletteStyles.enterHint, { color: theme.textSecondary }]}>↵</Text>}
            </PaletteListRow>
          );
        })}
        {rows.length === 0 && needle.length >= 2 && (
          <Text style={[paletteStyles.empty, { color: theme.textSecondary }]}>
            No matches — press ↵ to use "{needle}" directly
          </Text>
        )}
      </ScrollView>
      <View style={[styles.composeBar, { borderTopColor: theme.divider }]}>
        <TextInput
          ref={messageInputRef}
          value={text}
          onChangeText={setText}
          placeholder="iMessage"
          placeholderTextColor={theme.textSecondary}
          style={[styles.composeMessageInput, { borderColor: theme.divider, color: theme.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!canSend}
          onPress={send}
          style={[styles.sendButton, { backgroundColor: canSend ? theme.accent : theme.backgroundElement }]}
        >
          <Ionicons name="arrow-up" size={17} color={canSend ? theme.onAccent : theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
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
  messageTop: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  composeToRow: {
    alignItems: "flex-start",
    paddingVertical: 10,
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
    paddingHorizontal: 10,
  },
  composeToInput: {
    minWidth: 140,
    paddingVertical: 3,
  },
  composeBar: {
    alignItems: "center",
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
    minHeight: 34,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});
