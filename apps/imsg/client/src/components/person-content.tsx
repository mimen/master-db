import { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { usePersonView } from "@/hooks/use-person-view";
import { airtableRecordUrl } from "@/lib/airtable";
import { useActionSheet } from "@/lib/action-sheet";
import {
  conversationState,
  handleRows,
  personSubline,
  serviceIndex,
  sharedGroupLine,
  type HandleRow,
} from "@/lib/contact-order";
import { openExternalUrl } from "@/lib/external-link";
import { type Person, useAddHandle, useRenamePerson, useSetPrimaryHandle } from "@/lib/identity";
import { showToast } from "@/lib/toast";
import { ChatAvatar, PersonAvatar } from "./avatar";
import { ContactAddPanel } from "./contacts-add-panel";
import { useTheme } from "@/hooks/use-theme";
import { EnterFromBelow, HEADER_FONT, ServiceDot } from "./contacts-theme";
import { Card, ContactsButton, ContactsTopBar, IconAction, rowDivider, SectionHeader, TextAction } from "./contacts-ui";
import { PersonRelationship } from "./person-relationship";

export interface PersonContentProps {
  address: string;
  name?: string;
  /** The narrow auxiliary pane wants its own header with a back or close control. */
  showHeader?: boolean;
  onClose?: () => void;
  /** When set, the header shows a back chevron with this label instead of a close X. */
  onBack?: () => void;
  backLabel?: string;
  /** Phone: the stack's back button returns to the list. */
  onBackToList?: () => void;
}

type NameField = "first" | "last" | "nickname" | "organization";
const NAME_FIELDS: ReadonlyArray<{ key: NameField; label: string; placeholder: string }> = [
  { key: "first", label: "First", placeholder: "Add first name" },
  { key: "last", label: "Last", placeholder: "Add last name" },
  { key: "nickname", label: "Nickname", placeholder: "Add nickname" },
  { key: "organization", label: "Organization", placeholder: "Add organization" },
];

/** Below this width the page stacks into one column of inset grouped cards. */
const TWO_COLUMN_MIN = 820;

/**
 * The person page: identity, Name (editable in place), Reach <name> at,
 * Conversations, and the relationship column. Shared by the desktop Contacts
 * pane, the phone /person screen and the narrow auxiliary person pane.
 */
export function PersonContent({ address, name, showHeader = false, onClose, onBack, backLabel = "Back", onBackToList }: PersonContentProps) {
  const colors = useTheme();
  const chats = useChatDirectory();
  const { result, sortedChats, canCall, handleMessage, handleCall, openChat } = usePersonView(address, name);
  const [width, setWidth] = useState(0);
  const twoColumn = width >= TWO_COLUMN_MIN;
  const narrow = width > 0 && !twoColumn;

  const auxHeader = showHeader ? (
    <View style={[styles.auxHeader, { borderBottomColor: colors.divider }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} hitSlop={8} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{backLabel}</Text>
        </Pressable>
      ) : <Text style={[styles.auxTitle, { color: colors.textSecondary }]}>Profile</Text>}
      {onClose && !onBack ? <IconAction icon="close" label="Close contact" onPress={onClose} /> : null}
    </View>
  ) : null;

  if (result === undefined) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.thread }]}>
        {auxHeader}
        <ActivityIndicator style={styles.spinner} />
      </View>
    );
  }

  if (!result.found) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.thread }]}>
        {auxHeader}
        <ScrollView contentContainerStyle={styles.unknownWrap}>
          <ContactAddPanel handle={address} title="New contact" onDone={() => undefined} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.thread }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {auxHeader}
      {width === 0 ? null : (
        <FoundPerson
          key={result.person._id}
          person={result.person}
          tags={result.tags}
          events={result.events}
          identities={result.identities}
          address={address}
          chats={chats ?? []}
          sortedChats={sortedChats}
          twoColumn={twoColumn}
          narrow={narrow}
          showTopBar={!showHeader}
          canCall={canCall}
          onMessage={handleMessage}
          onCall={handleCall}
          onOpenChat={openChat}
          onBackToList={onBackToList}
        />
      )}
    </View>
  );
}

function FoundPerson({
  person, tags, events, identities, address, chats, sortedChats, twoColumn, narrow, showTopBar, canCall, onMessage, onCall, onOpenChat, onBackToList,
}: {
  readonly person: Person;
  readonly tags: string[];
  readonly events: Parameters<typeof PersonRelationship>[0]["events"];
  readonly identities: Parameters<typeof handleRows>[1];
  readonly address: string;
  readonly chats: readonly ChatSummary[];
  readonly sortedChats: ChatSummary[];
  readonly twoColumn: boolean;
  readonly narrow: boolean;
  readonly showTopBar: boolean;
  readonly canCall: boolean;
  readonly onMessage: () => void;
  readonly onCall: () => void;
  readonly onOpenChat: (chat: ChatSummary) => void;
  readonly onBackToList?: () => void;
}) {
  const colors = useTheme();
  const showSheet = useActionSheet();
  const renamePerson = useRenamePerson();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<NameField, string>>(() => nameForm(person));
  const displayName = person.display_name ?? address;
  const firstName = person.first_name || displayName.split(" ")[0];

  const startEdit = () => {
    setForm(nameForm(person));
    setEditing(true);
  };
  const finishEdit = async () => {
    setEditing(false);
    const before = nameForm(person);
    if (NAME_FIELDS.every(({ key }) => form[key].trim() === before[key])) return;
    // Keep a deliberate display override; otherwise let the server derive "First Last".
    const derived = [person.first_name, person.last_name].filter(Boolean).join(" ");
    const override = person.display_name && person.display_name !== derived ? person.display_name : undefined;
    try {
      await renamePerson({
        personId: person._id,
        display_name: override,
        first_name: form.first.trim(),
        last_name: form.last.trim(),
        nickname: form.nickname.trim(),
        organization: form.organization.trim(),
      });
    } catch {
      showToast("Couldn't save the name. Try again.");
    }
  };

  const airtableId = person.airtable_human_id;
  const more = airtableId ? (
    <IconAction
      icon="ellipsis-horizontal"
      label="More"
      onPress={() => showSheet({ actions: [{ label: "View in Airtable", onPress: () => void openExternalUrl(airtableRecordUrl(airtableId)) }] })}
    />
  ) : null;

  const actions = narrow ? null : (
    <View style={styles.identActions}>
      <ContactsButton label="Message" icon="chatbubble-outline" onPress={onMessage} />
      {editing
        ? <ContactsButton testID="person-done" label="Done" tone="primary" onPress={() => void finishEdit()} />
        : <ContactsButton testID="person-edit" label="Edit" icon="pencil-outline" onPress={startEdit} />}
    </View>
  );

  const identity = narrow ? (
    <View style={styles.identPhone}>
      <PersonAvatar address={address} name={displayName} size={84} />
      <View style={styles.nameRow}>
        <Text accessibilityRole="header" style={[styles.namePhone, { color: colors.text, fontFamily: HEADER_FONT }]}>{displayName}</Text>
        {person.is_favorite ? <Ionicons name="star" size={18} color={colors.text} accessibilityLabel="Favorite" /> : null}
      </View>
      {person.organization ? <Text style={[styles.subPhone, { color: colors.textSecondary }]}>{person.organization}</Text> : null}
      <View style={styles.quickRow}>
        <QuickAction icon="chatbubble-outline" label="Message" onPress={onMessage} />
        <QuickAction icon="call-outline" label="Call" onPress={onCall} disabled={!canCall} />
      </View>
    </View>
  ) : (
    <View style={styles.ident}>
      <PersonAvatar address={address} name={displayName} size={64} />
      <View style={styles.identText}>
        <View style={styles.nameRow}>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.name, { color: colors.text, fontFamily: HEADER_FONT }]}>{displayName}</Text>
          {person.is_favorite ? <Ionicons name="star" size={16} color={colors.text} accessibilityLabel="Favorite" /> : null}
        </View>
        <Text numberOfLines={1} style={[styles.sub, { color: colors.textSecondary }]}>{personSubline(person)}</Text>
      </View>
      {actions}
    </View>
  );

  const nameCard = (
    <View>
      <SectionHeader title="Name" />
      <Card>
        {NAME_FIELDS.map(({ key, label, placeholder }, i) => (
          <View key={key} style={[styles.fld, rowDivider(colors, i === 0)]}>
            <Text style={[styles.k, { color: colors.textSecondary }]}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              editable={editing}
              autoFocus={editing && i === 0}
              value={editing ? form[key] : nameForm(person)[key]}
              onChangeText={(t) => setForm((f) => ({ ...f, [key]: t }))}
              onSubmitEditing={() => void finishEdit()}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.inp,
                { color: colors.text, borderColor: editing ? colors.dividerStrong : "transparent", backgroundColor: editing ? colors.thread : "transparent" },
                Platform.OS === "web" && ({ transition: "border-color 120ms, background-color 120ms", outlineColor: colors.focusRing } as object),
              ]}
            />
          </View>
        ))}
      </Card>
    </View>
  );

  const main = (
    <>
      {identity}
      {narrow ? null : nameCard}
      <HandlesSection person={person} identities={identities} chats={chats} firstName={firstName} grouped={narrow} />
      <ConversationsSection person={person} chats={sortedChats} onOpen={onOpenChat} grouped={narrow} />
      {narrow && editing ? nameCard : null}
    </>
  );

  const relationship = (
    <PersonRelationship
      personId={person._id}
      isFavorite={person.is_favorite ?? false}
      priority={person.priority}
      tags={tags}
      events={events}
      notes={person.notes}
      notesUpdatedAt={person.notes_updated_at}
      grouped={narrow}
    />
  );

  return (
    <View style={styles.fill}>
      {showTopBar && !narrow ? (
        <ContactsTopBar title={displayName} note={editing ? "Editing" : undefined} trailing={more} />
      ) : null}
      {narrow && showTopBar ? (
        <View style={styles.phoneNav}>
          {onBackToList ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Contacts" onPress={onBackToList} hitSlop={8} style={styles.back}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
              <Text style={[styles.phoneNavText, { color: colors.text }]}>Contacts</Text>
            </Pressable>
          ) : <View />}
          <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Done" : "Edit"} onPress={editing ? () => void finishEdit() : startEdit} hitSlop={8}>
            <Text style={[styles.phoneNavText, styles.phoneNavAction, { color: colors.text }]}>{editing ? "Done" : "Edit"}</Text>
          </Pressable>
        </View>
      ) : null}
      <EnterFromBelow motionKey={person._id}>
        {twoColumn ? (
          <View style={styles.pp}>
            <ScrollView style={styles.fill} contentContainerStyle={styles.ppm}>{main}</ScrollView>
            <ScrollView style={[styles.ppa, { backgroundColor: colors.background, borderLeftColor: colors.divider }]} contentContainerStyle={styles.ppaContent}>
              {relationship}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.fill} contentContainerStyle={styles.stack}>
            {main}
            {relationship}
            {narrow ? <OtherNetworksSection person={person} identities={identities} chats={chats} /> : null}
          </ScrollView>
        )}
      </EnterFromBelow>
    </View>
  );
}

function nameForm(person: Person): Record<NameField, string> {
  return {
    first: person.first_name ?? "",
    last: person.last_name ?? "",
    nickname: person.nickname ?? "",
    organization: person.organization ?? "",
  };
}

function QuickAction({ icon, label, onPress, disabled }: {
  readonly icon: React.ComponentProps<typeof Ionicons>["name"];
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.quick, { backgroundColor: colors.surface, borderColor: colors.divider }, pressed && { backgroundColor: colors.rowHover }, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
      <Text style={[styles.quickLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function HandlesSection({ person, identities, chats, firstName, grouped }: {
  readonly person: Person;
  readonly identities: Parameters<typeof handleRows>[1];
  readonly chats: readonly ChatSummary[];
  readonly firstName: string;
  readonly grouped: boolean;
}) {
  const colors = useTheme();
  const setPrimary = useSetPrimaryHandle();
  const addHandle = useAddHandle();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const serviceOf = useMemo(() => serviceIndex(chats), [chats]);
  const rows = handleRows(person, identities, serviceOf);
  const submit = () => {
    const handle = draft.trim();
    setAdding(false);
    setDraft("");
    if (handle) {
      void addHandle({ personId: person._id, handle }).catch((e: unknown) =>
        showToast(e instanceof Error && e.message.includes("another contact") ? "That handle belongs to another contact." : "Couldn't add the handle. Try again."));
    }
  };
  const visible = grouped ? rows.filter((r) => r.reachable) : rows;
  return (
    <View>
      <SectionHeader title={`Reach ${firstName} at`} trailing={<TextAction label="Add handle" onPress={() => setAdding(true)} />} />
      <Card>
        {visible.map((row, i) => (
          <HandleLine
            key={row.key}
            row={row}
            first={i === 0}
            grouped={grouped}
            onMakePrimary={() => void setPrimary({ personId: person._id, handle: row.value }).catch(() => showToast("Couldn't change the primary handle. Try again."))}
          />
        ))}
        {adding ? (
          <View style={[styles.hrow, rowDivider(colors, visible.length === 0)]}>
            <TextInput
              autoFocus
              accessibilityLabel="New phone number or email"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submit}
              onBlur={submit}
              placeholder="Phone number or email"
              placeholderTextColor={colors.textTertiary}
              style={[styles.inp, styles.flex, { color: colors.text, borderColor: colors.dividerStrong, backgroundColor: colors.thread }]}
            />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/** The phone page's last section: handles Messages can't reach, such as Instagram. */
function OtherNetworksSection({ person, identities, chats }: {
  readonly person: Person;
  readonly identities: Parameters<typeof handleRows>[1];
  readonly chats: readonly ChatSummary[];
}) {
  const colors = useTheme();
  const serviceOf = useMemo(() => serviceIndex(chats), [chats]);
  const rows = handleRows(person, identities, serviceOf).filter((r) => !r.reachable);
  if (rows.length === 0) return null;
  return (
    <View>
      <SectionHeader title="Other networks" />
      <Card>
        {rows.map((row, i) => (
          <View key={row.key} style={[styles.hrowGrouped, rowDivider(colors, i === 0)]}>
            <Text style={[styles.kGrouped, { color: colors.textSecondary }]}>{row.label}</Text>
            <Text style={[styles.vGrouped, { color: colors.text }]}>{row.display}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function HandleLine({ row, first, grouped, onMakePrimary }: {
  readonly row: HandleRow;
  readonly first: boolean;
  readonly grouped: boolean;
  readonly onMakePrimary: () => void;
}) {
  const colors = useTheme();
  const service = (
    <View style={styles.svc}>
      <ServiceDot service={row.service} size={grouped ? 9 : 7} />
      <Text style={[grouped ? styles.svcTextGrouped : styles.svcText, { color: colors.textSecondary }]}>{row.service}</Text>
    </View>
  );
  const state = row.primary ? (
    <Text style={[styles.prim, { backgroundColor: colors.field, color: colors.text }]}>Primary</Text>
  ) : row.reachable && !grouped ? (
    <TextAction label="Make primary" accessibilityLabel={`Make ${row.display} primary`} onPress={onMakePrimary} />
  ) : null;
  if (grouped) {
    return (
      <View testID="handle-row" style={[styles.hrowGrouped, rowDivider(colors, first)]}>
        <View style={styles.flex}>
          <Text style={[styles.kGrouped, { color: colors.textSecondary }]}>{row.label}</Text>
          <Text style={[styles.vGrouped, { color: colors.text }]}>{row.display}</Text>
        </View>
        {service}
        {state}
      </View>
    );
  }
  return (
    <View testID="handle-row" style={[styles.hrow, rowDivider(colors, first)]}>
      <Text style={[styles.k, { color: colors.textSecondary }]}>{row.label}</Text>
      <Text numberOfLines={1} style={[styles.v, { color: colors.text }]}>{row.display}</Text>
      {service}
      <View style={styles.stateSlot}>{state}</View>
    </View>
  );
}

function ConversationsSection({ person, chats, onOpen, grouped }: {
  readonly person: Person;
  readonly chats: ChatSummary[];
  readonly onOpen: (chat: ChatSummary) => void;
  readonly grouped: boolean;
}) {
  const colors = useTheme();
  if (chats.length === 0) return null;
  const now = Date.now();
  const handles = [...person.normalized_phones, ...person.normalized_emails];
  const ordered = [...chats.filter((c) => !c.isGroup), ...chats.filter((c) => c.isGroup)];
  return (
    <View>
      <SectionHeader title="Conversations" trailing={grouped ? undefined : String(chats.length)} />
      <Card>
        {ordered.map((chat, i) => {
          const state = conversationState(chat, now);
          const title = chat.isGroup ? chat.displayName : person.display_name ?? chat.displayName;
          const line = chat.isGroup ? sharedGroupLine(chat, handles) : chat.lastMessage?.text ?? "";
          if (grouped) {
            const meta = chat.isGroup ? [state.label && `${state.label} ago`, `${chat.participants.length + 1} people`].filter(Boolean).join(", ") : state.label;
            return (
              <Pressable key={chat.guid} accessibilityRole="button" accessibilityLabel={`${title}, ${meta}`} onPress={() => onOpen(chat)} style={[styles.hrowGrouped, styles.convGrouped, rowDivider(colors, i === 0)]}>
                <Text style={[styles.kGrouped, { color: state.yourTurn ? colors.turn : colors.textSecondary }]}>{meta}</Text>
                <Text style={[styles.vGrouped, { color: colors.text }]}>{title}</Text>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={chat.guid}
              testID="person-conversation"
              accessibilityRole="button"
              accessibilityLabel={`${title}. ${line}. ${state.label}`}
              onPress={() => onOpen(chat)}
              style={({ hovered }: { hovered?: boolean }) => [styles.conv, rowDivider(colors, i === 0), hovered && { backgroundColor: colors.rowHover }]}
            >
              <ChatAvatar chat={chat} size={32} />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.t1, { color: colors.text }]}>{title}</Text>
                <Text numberOfLines={1} style={[styles.t2, { color: colors.textSecondary }]}>{line}</Text>
              </View>
              <Text style={[styles.age, { color: state.yourTurn ? colors.turn : colors.textTertiary }, state.yourTurn && styles.ageTurn]}>{state.label}</Text>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  spinner: { marginTop: 48 },
  unknownWrap: { alignItems: "center", padding: 24 },
  auxHeader: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", height: 48, justifyContent: "space-between", paddingHorizontal: 12 },
  auxTitle: { fontSize: 13, fontWeight: "600" },
  back: { alignItems: "center", flexDirection: "row", gap: 2 },
  pp: { flex: 1, flexDirection: "row" },
  ppm: { gap: 22, maxWidth: 1000, paddingBottom: 30, paddingHorizontal: 40, paddingTop: 26 },
  ppa: { borderLeftWidth: 1, flexGrow: 0, width: 320 },
  ppaContent: { paddingHorizontal: 22, paddingVertical: 26 },
  stack: { gap: 22, paddingBottom: 40, paddingHorizontal: 16, paddingTop: 8 },
  ident: { alignItems: "center", flexDirection: "row", gap: 16 },
  identText: { flex: 1, minWidth: 0 },
  identActions: { flexDirection: "row", gap: 6 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  name: { flexShrink: 1, fontSize: 24, letterSpacing: -0.4 },
  sub: { fontSize: 13, marginTop: 2 },
  identPhone: { alignItems: "center", gap: 6 },
  namePhone: { fontSize: 26, letterSpacing: -0.5, marginTop: 10 },
  subPhone: { fontSize: 15 },
  quickRow: { alignSelf: "stretch", flexDirection: "row", gap: 10, marginTop: 14 },
  quick: { alignItems: "center", borderRadius: 14, borderWidth: 1, flex: 1, gap: 6, paddingVertical: 12 },
  quickLabel: { fontSize: 13, fontWeight: "500" },
  phoneNav: { alignItems: "center", flexDirection: "row", height: 44, justifyContent: "space-between", paddingHorizontal: 12 },
  phoneNavText: { fontSize: 17 },
  phoneNavAction: { fontWeight: "600" },
  fld: { alignItems: "center", flexDirection: "row", minHeight: 42, paddingHorizontal: 14 },
  k: { fontSize: 12.5, width: 110 },
  inp: { borderRadius: 6, borderWidth: 1, flex: 1, fontSize: 13, height: 28, marginLeft: -9, paddingHorizontal: 8 },
  hrow: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 44, paddingHorizontal: 14 },
  hrowGrouped: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 },
  convGrouped: { alignItems: "flex-start", flexDirection: "column", gap: 2 },
  kGrouped: { fontSize: 13 },
  vGrouped: { fontSize: 16, marginTop: 2 },
  v: { flex: 1, fontSize: 13, fontVariant: ["tabular-nums"], minWidth: 0 },
  svc: { alignItems: "center", flexDirection: "row", gap: 5 },
  svcText: { fontSize: 12 },
  svcTextGrouped: { fontSize: 15 },
  stateSlot: { alignItems: "flex-end", minWidth: 82 },
  prim: { borderRadius: 6, fontSize: 11.5, fontWeight: "600", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
  conv: { alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  t1: { fontSize: 13, fontWeight: "600" },
  t2: { fontSize: 12.5, marginTop: 1 },
  age: { fontSize: 12, fontVariant: ["tabular-nums"], textAlign: "right" },
  ageTurn: { fontWeight: "600" },
});
