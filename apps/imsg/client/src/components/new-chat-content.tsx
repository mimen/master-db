import Ionicons from "@expo/vector-icons/Ionicons";
import { addressesMatch, formatAddress } from "@shared/address";
import { conversationRoute, fromBridgeMessage } from "@shared/imessage";
import type { Contact, ConversationId, Message } from "@shared/types";
import { router } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ChipField, ComposeSheet, SheetFooter, WEB_INPUT } from "@/components/compose-sheet";
import { useAirtableSearch } from "@/hooks/use-airtable-search";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import { afterPaint } from "@/lib/open-timing";
import { composeSections, type ComposeRow } from "@/lib/palette/compose-rows";
import { draftBubble, pendingSends } from "@/lib/pending-sends";
import { conversationRoute as threadHref, selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";

import { PersonAvatar } from "./avatar";
import { PaletteListRow, PaletteSectionHeader, paletteStyles, usePaletteCursor } from "./palette/palette-list";

/** Opens a conversation in the shell, or as a route on a phone. */
function show(conversationId: ConversationId, name?: string): void {
  if (!selectChat({ conversationId, ...(name ? { name } : {}) })) router.push(threadHref(conversationId));
}

/**
 * New message, on the compose sheet. The To field searches people as you type and its rows replace the body until
 * someone is picked; then the body takes the first message. On the web, arrows rove the rows, Enter adds the selected
 * one from To and sends from the body, and ⇧Enter is a new line.
 */
export function NewChatContent({ onClose, initialContact, presentation }: {
  onClose: () => void;
  /** Pre-fills the recipient: the person view's "Message" for someone with no thread yet. */
  initialContact?: Contact;
  /** A phone route draws the sheet as its page. */
  presentation?: "overlay" | "screen";
}): React.JSX.Element {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const [recipients, setRecipients] = useState<Contact[]>(initialContact ? [initialContact] : []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ needle: string; contacts: Contact[] }>({ needle: "", contacts: [] });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const toRef = useRef<TextInput>(null);
  const bodyRef = useRef<TextInput>(null);
  const directory = useChatDirectory();

  const needle = query.trim();
  // The last answer stays on screen while the next one loads, so rows never blank between keys;
  // the directory's own matches fill in instantly in the meantime.
  useEffect(() => {
    if (needle.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      api.contacts(needle).then((found) => {
        if (!cancelled) setResults({ needle, contacts: found });
      }).catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [needle]);
  const searching = needle.length >= 2 && results.needle !== needle;

  const addRecipient = (contact: Contact): void => {
    setRecipients((current) => (current.some((x) => addressesMatch(x.address, contact.address)) ? current : [...current, contact]));
    setQuery("");
    toRef.current?.focus();
  };
  // Unlinked Airtable humans can be added, then land as a recipient, as on the Contacts surfaces.
  const { results: airtableResults, add: addAirtableContact, addingId } = useAirtableSearch(needle, (_personId, human) => {
    const address = human.phone ?? human.email;
    if (address) addRecipient({ address, name: human.display_name });
  });

  const sections = useMemo(() => composeSections({
    query,
    recipients,
    directory: directory ?? [],
    contacts: needle.length >= 2 ? results.contacts : [],
    airtable: airtableResults,
  }), [query, recipients, directory, needle, results.contacts, airtableResults]);
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const cursor = usePaletteCursor(useMemo(() => rows.map((row) => row.key), [rows]));
  const { reset } = cursor;
  useEffect(() => reset(), [needle, reset]);
  const picking = needle !== "" || recipients.length === 0;

  const [only] = recipients;
  const existing = recipients.length === 1 && only ? directory?.find((chat) => !chat.isGroup && conversationRoute(chat).service === "iMessage" &&
    chat.participants.length === 1 && addressesMatch(chat.participants[0]?.address ?? "", only.address)) : undefined;
  const canSend = recipients.length > 0 && text.trim().length > 0 && !sending;

  const send = (): void => {
    const body = text.trim();
    if (recipients.length === 0 || body === "" || sending) return;
    setSending(true);
    // createChat lands one recipient in their iMessage conversation; when that already exists, the message shows there
    // on the click, as a composer send does. A new chat's first message is not a queued send, so it cannot be cancelled.
    const temp: Message | null = existing ? { ...draftBubble(existing, { text: body }), sendState: "sending" } : null;
    if (existing && temp) {
      pendingSends.upsert(existing.conversationId, temp);
      // Mounting the thread costs a long frame; the Sending ring paints first, on the frame of the click.
      afterPaint(() => {
        onClose();
        show(existing.conversationId, existing.displayName);
      });
    }
    runCommand(null, { kind: "createChat", addresses: recipients.map((c) => c.address), text: body })
      .then(({ conversationId, message }) => {
        if (existing && temp && conversationId === existing.conversationId) return pendingSends.settle(conversationId, temp.guid, fromBridgeMessage(message));
        if (existing && temp) pendingSends.retain(existing.conversationId, (m) => m.guid !== temp.guid);
        onClose();
        if (conversationId) show(conversationId);
      })
      .catch((e: unknown) => {
        if (existing && temp) pendingSends.strand(existing.conversationId, temp);
        const detail = e instanceof Error ? /"error"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] : undefined;
        showToast(messagingCommandError(e, detail ? `Couldn't start: ${detail.slice(0, 120)}` : e instanceof Error ? `Couldn't start: ${e.message.slice(0, 120)}` : "Couldn't start the conversation"));
      })
      .finally(() => setSending(false));
  };

  const choose = (row: ComposeRow): void => {
    if (row.kind === "airtable") void addAirtableContact(row.human);
    else addRecipient(row.contact);
  };
  /** Enter in To: add the selected row, or move on to the body once someone is picked. */
  const submitTo = (): void => {
    const row = rows[cursor.indexRef.current];
    if (row && needle !== "") return choose(row);
    if (needle === "" && recipients.length > 0) bodyRef.current?.focus();
    else if (row) choose(row);
  };

  const live = useRef({ send, submitTo, picking });
  live.current = { send, submitTo, picking };
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent): void => {
      const inBody = document.activeElement === (bodyRef.current as unknown as Element | null);
      const inTo = document.activeElement === (toRef.current as unknown as Element | null);
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && inTo && live.current.picking) {
        e.preventDefault();
        e.stopPropagation();
        cursorRef.current.move(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter" && (inTo || (inBody && !e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        if (inBody) live.current.send();
        else live.current.submitTo();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  let flatIndex = -1;
  return (
    <ComposeSheet title="New message" presentation={presentation} dirty={text.trim() !== ""} onClose={onClose}>
      <ChipField
        label="To"
        chips={recipients.map((contact) => ({ key: contact.address, label: contact.name === contact.address ? formatAddress(contact.address) : contact.name }))}
        onRemove={(address) => setRecipients((current) => current.filter((c) => c.address !== address))}
        input={{
          ref: toRef,
          value: query,
          onChangeText: setQuery,
          placeholder: recipients.length === 0 ? "Name, number, or email" : "Add another",
          autoFocus: true,
          spellCheck: false,
          // react-native-web reads blurOnSubmit, not submitBehavior; Enter picks and keeps typing.
          blurOnSubmit: false,
          onSubmitEditing: submitTo,
        }}
      />
      {picking ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.fill} contentContainerStyle={styles.rows}>
          {sections.map((section) => (
            <Fragment key={section.title}>
              <PaletteSectionHeader title={section.title} />
              {section.rows.map((row) => {
                flatIndex += 1;
                const index = flatIndex;
                const name = row.kind === "airtable" ? row.human.display_name : row.contact.name;
                const address = row.kind === "airtable" ? row.human.phone ?? row.human.email ?? null : row.contact.address;
                const adding = row.kind === "airtable" && addingId === row.human.record_id;
                return (
                  <PaletteListRow
                    key={row.key}
                    paletteKey={row.key}
                    selected={index === cursor.selectedIndex}
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
          {rows.length === 0 && needle.length >= 2 ? (
            <Text style={[paletteStyles.empty, { color: theme.textSecondary }]}>
              {searching ? "Searching…" : `No one matches “${needle}”. Type a full number or email to start a new conversation.`}
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <TextInput
          ref={bodyRef}
          accessibilityLabel="Message"
          placeholder="Message"
          placeholderTextColor={theme.textTertiary}
          value={text}
          onChangeText={setText}
          multiline
          style={[styles.body, { color: theme.text }, WEB_INPUT]}
        />
      )}
      <SheetFooter
        note={existing ? `This continues your conversation with ${existing.displayName}.` : wide ? "↩ to send, ⇧↩ for a new line" : undefined}
        ready={canSend}
        sending={sending}
        onSend={send}
      />
    </ComposeSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  rows: { paddingBottom: 8, paddingHorizontal: 6, paddingTop: 6 },
  body: { flex: 1, fontSize: 14, lineHeight: 21, paddingHorizontal: 16, paddingTop: 12, textAlignVertical: "top" },
});
