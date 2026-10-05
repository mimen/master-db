import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api, attachmentThumbnailUrl } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { pinChat } from "@/lib/chat-actions";
import { contactService } from "@/lib/contact-service";
import { useAddChatTag } from "@/lib/identity";
import { useLightbox } from "@/lib/lightbox";
import { showToast } from "@/lib/toast";
import type { ChatSummary, Contact, ContactSuggestion } from "@shared/types";
import { formatAddress } from "@shared/address";
import { useTypeRamp } from "@/hooks/use-type";
import { useAiStatus } from "@/hooks/use-ai";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { ChatAvatar, GroupPhotoAvatar, PersonAvatar } from "./avatar";
import { ChatCrmSection } from "./chat-crm-section";
import { useQuery } from "convex/react";
import { commaApi } from "@/lib/convex-api";
import { mediaApi } from "@/lib/media-api";
import { MediaUnavailable } from "./media";
import { CenteredSpinner } from "./empty-state";
import { ListRow } from "./list-row";
import { ServiceLabel } from "./service-label";
import { useTheme } from "@/hooks/use-theme";
import type { ThemeColors } from "@/components/ui/interaction";

const GRID_GAP = 4;
const GRID_MAX = 6;

export interface ChatInfoContentProps {
  guid: string;
  /** Close the info surface (pane dismiss on desktop, router.back on native). */
  onClose: () => void;
  /** The conversation was deleted; caller clears selection / navigates home. */
  onDeleted: () => void;
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  /** Desktop: open a participant over this pane instead of the mobile route. */
  onOpenPerson?: (address: string, name: string) => void;
}

export function ChatInfoContent({
  guid,
  onClose,
  onDeleted,
  showHeader = false,
  onOpenPerson,
}: ChatInfoContentProps) {
  const theme = useTheme();
  const type = useTypeRamp();
  const showSheet = useActionSheet();
  const openLightbox = useLightbox();
  const chats = useChatDirectory();
  const [info, setInfo] = useState<{
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  } | null>(null);
  const conversation = useQuery(commaApi.resolveChat, guid ? { chatGuid: guid } : "skip");
  const gallery = useQuery(mediaApi.gallery, conversation ? { conversationId: conversation._id } : "skip") ?? [];
  const [gridWidth, setGridWidth] = useState(0);
  const onGridLayout = useCallback((width: number): void => {
    const next = Math.round(width);
    setGridWidth((current) => (current === next ? current : next));
  }, []);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const aiStatus = useAiStatus();
  const [identity, setIdentity] = useState<ContactSuggestion | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [participantAddress, setParticipantAddress] = useState("");
  const [tagging, setTagging] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const addChatTag = useAddChatTag();

  const identify = () => {
    setIdentifying(true);
    api
      .aiIdentify(guid)
      .then(setIdentity)
      .catch(() => showToast("Couldn't look up this contact. Try again."))
      .finally(() => setIdentifying(false));
  };

  const load = useCallback(() => {
    if (!guid) return;
    api.chatInfo(guid).then((i) => {
      setInfo(i);
      setName(i.displayName ?? "");
    }).catch(() => undefined);
  }, [guid]);

  useEffect(load, [load]);

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.paneHeaderTitle, { color: theme.text, fontSize: type.body }]}>Details</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        hitSlop={8}
        accessibilityLabel="Close details"
        style={({ hovered, pressed }) => [styles.headerIcon, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
      >
        {({ hovered, pressed }) => <Ionicons name="close" size={18} color={hovered || pressed ? theme.text : theme.icon} />}
      </Pressable>
    </View>
  ) : null;

  if (!guid || !info) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        {showHeader ? null : <CenteredSpinner style={{ backgroundColor: theme.background }} />}
      </View>
    );
  }

  const saveName = () => {
    setRenaming(false);
    if (name.trim() && name !== info.displayName) {
      api.renameGroup(guid, name.trim())
        .then(() => setInfo((current) => current ? { ...current, displayName: name.trim() } : current))
        .catch(() => showToast("Couldn't rename the conversation. Try again."));
    }
  };

  const removeParticipant = (p: Contact) => {
    showSheet({
      title: p.name,
      actions: [
        {
          label: "Remove from conversation",
          destructive: true,
          onPress: () =>
            runCommand(guid, { kind: "participant", address: p.address, action: "remove" }).then(load).catch((error: unknown) => showToast(messagingCommandError(error, `Couldn't remove ${p.name ?? formatAddress(p.address)}. Try again.`))),
        },
      ],
    });
  };

  const summary = chats?.find((c) => c.guid === guid) ?? null;
  const peer = info.isGroup ? null : info.participants[0];
  const peerName = peer ? peer.name ?? formatAddress(peer.address) : null;
  const crm = summary?.crm;
  const tags = crm?.tags ?? [];
  const pinned = summary?.flags.pinned ?? false;
  const tile = gridWidth > 0 ? (gridWidth - 2 * GRID_GAP) / 3 : 0;
  const openPerson = (p: Contact): void => {
    const nm = p.name ?? formatAddress(p.address);
    if (onOpenPerson) onOpenPerson(p.address, nm);
    else router.push({ pathname: "/person", params: { address: p.address, name: p.name ?? "" } });
  };
  const submitTag = (): void => {
    const tag = tagInput.trim();
    setTagInput("");
    setTagging(false);
    if (tag) addChatTag({ chatGuid: guid, tag }).catch(() => showToast("Couldn't add the tag. Try again."));
  };
  const confirmDelete = (): void =>
    showSheet({
      title: "Delete this conversation? This can't be undone.",
      actions: [
        {
          label: "Delete conversation",
          destructive: true,
          onPress: () =>
            runCommand(guid, { kind: "deleteChat", chatGuid: guid })
              .then(() => onDeleted())
              .catch((error: unknown) => showToast(messagingCommandError(error, "Couldn't delete the conversation. Try again."))),
        },
      ],
    });
  const confirmLeave = (): void =>
    showSheet({
      title: "Leave this conversation? You'll stop getting its messages.",
      actions: [
        {
          label: "Leave conversation",
          destructive: true,
          onPress: () =>
            runCommand(guid, { kind: "leaveGroup" }).then(() => onClose()).catch((error: unknown) => showToast(messagingCommandError(error, "Couldn't leave the conversation. Try again."))),
        },
      ],
    });

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView
        style={[
          { flex: 1 },
          Platform.OS === "web" ? ({ scrollbarGutter: "stable" } as object) : null,
        ]}
        contentContainerStyle={styles.body}
      >
        <View style={styles.hero}>
          {summary ? <ChatAvatar chat={summary} size={64} /> : peer ? <PersonAvatar address={peer.address} name={peerName ?? ""} size={64} /> : <GroupPhotoAvatar guid={guid} size={64} />}
        </View>
        {info.isGroup && renaming ? (
          <View style={styles.renameRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              onSubmitEditing={saveName}
              placeholder="Group name"
              placeholderTextColor={theme.textTertiary}
              style={[styles.renameInput, { color: theme.text, borderColor: theme.dividerStrong }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save name"
              onPress={saveName}
              style={({ hovered, pressed }) => [styles.inlineTextAction, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
            >
              <Text style={{ color: theme.text, fontSize: type.body, fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole={info.isGroup ? "button" : undefined}
            accessibilityLabel={info.isGroup ? "Rename group" : undefined}
            disabled={!info.isGroup}
            style={styles.titleRow}
            onPress={() => setRenaming(true)}
          >
            <Text style={[styles.title, { color: theme.text }]}>
              {info.isGroup ? info.displayName || `${info.participants.length} people` : peerName ?? "Details"}
            </Text>
            {crm?.is_favorite && <Ionicons name="star" size={16} color={theme.text} accessibilityLabel="Favorite" />}
            {info.isGroup && <Ionicons name="pencil" size={14} color={theme.icon} />}
          </Pressable>
        )}
        {info.isGroup ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary, fontSize: type.secondary }]}>
            {`You and ${info.participants.length} ${info.participants.length === 1 ? "other" : "others"}`}
          </Text>
        ) : aiStatus?.suggestions && !peer?.name ? (
          <View style={styles.identifyBlock}>
            {identity ? (
              <View style={[styles.identityCard, { backgroundColor: theme.field }]}>
                <View style={styles.identityHead}>
                  <Ionicons name="sparkles" size={13} color={theme.icon} />
                  <Text style={{ color: theme.text, fontSize: type.body, fontWeight: "600", flex: 1 }}>
                    {identity.name ?? "Couldn't place them"}
                  </Text>
                  <Text style={[styles.confidence, { color: theme.textTertiary }]}>{identity.confidence}</Text>
                </View>
                <Text style={{ color: theme.textSecondary, fontSize: type.secondary, lineHeight: 18 }}>{identity.reasoning}</Text>
              </View>
            ) : (
              <Pressable onPress={identify} disabled={identifying} style={styles.suggestTrigger} hitSlop={6}>
                {identifying ? <ActivityIndicator size="small" /> : <Ionicons name="help-circle-outline" size={15} color={theme.textSecondary} />}
                <Text style={{ color: theme.textSecondary, fontSize: type.secondary, fontWeight: "500" }}>
                  {identifying ? "Looking…" : "Who is this?"}
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {(tags.length > 0 || info.isGroup) && (
          <View style={styles.tags}>
            {tags.map((tag) => (
              <View key={tag} style={[styles.tag, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
                <Text style={[styles.tagText, { color: theme.textSecondary }]}>{tag}</Text>
              </View>
            ))}
            {info.isGroup && (tagging ? (
              <View style={[styles.tag, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
                <TextInput
                  autoFocus
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={submitTag}
                  onBlur={submitTag}
                  placeholder="Tag"
                  placeholderTextColor={theme.textTertiary}
                  accessibilityLabel="New tag"
                  style={[styles.tagText, styles.tagInput, { color: theme.text }]}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add tag"
                onPress={() => setTagging(true)}
                style={({ hovered, pressed }) => [styles.tag, { borderColor: theme.dividerStrong }, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
              >
                <Ionicons name="add" size={13} color={theme.textSecondary} />
                <Text style={[styles.tagText, { color: theme.textSecondary }]}>Tag</Text>
              </Pressable>
            ))}
          </View>
        )}

        {peer ? (
          <Section title={`Reach ${(peerName ?? "").split(" ")[0] || "them"} at`} divider={theme.divider} labelColor={theme.textSecondary}>
            {info.participants.map((p) => {
              const service = contactService(p.address, chats);
              return (
                <Pressable
                  key={p.address}
                  accessibilityRole="button"
                  accessibilityLabel={p.name ?? formatAddress(p.address)}
                  onPress={() => openPerson(p)}
                  style={({ hovered, pressed }) => [styles.handleRow, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
                >
                  <Text style={[styles.handleKind, { color: theme.textTertiary, fontSize: type.caption }]}>{p.address.includes("@") ? "email" : "phone"}</Text>
                  <Text numberOfLines={1} style={[styles.handleValue, { color: theme.text, fontSize: type.body }]}>{formatAddress(p.address)}</Text>
                  {service && <ServiceLabel service={service} size={type.caption} />}
                </Pressable>
              );
            })}
          </Section>
        ) : (
          <Section
            title="Members"
            divider={theme.divider}
            labelColor={theme.textSecondary}
            action={addingParticipant ? undefined : { label: "Add person", onPress: () => setAddingParticipant(true) }}
          >
            {info.participants.map((p) => {
              const service = contactService(p.address, chats);
              return (
                <ListRow
                  key={p.address}
                  paddingHorizontal={8}
                  titleWeight="400"
                  hoverFill={theme.rowHover}
                  style={styles.memberRow}
                  onPress={() => openPerson(p)}
                  onLongPress={() => removeParticipant(p)}
                  leading={<PersonAvatar address={p.address} name={p.name ?? formatAddress(p.address)} size={36} />}
                  title={p.name ?? formatAddress(p.address)}
                  subtitle={p.name ? formatAddress(p.address) : undefined}
                  trailing={service ? <ServiceLabel service={service} size={type.caption} /> : undefined}
                />
              );
            })}
            {addingParticipant && (
              <View style={styles.addPersonEditor}>
                <TextInput
                  autoFocus
                  value={participantAddress}
                  onChangeText={setParticipantAddress}
                  onSubmitEditing={() => {
                    const address = participantAddress.trim();
                    if (!address) return;
                    void runCommand(guid, { kind: "participant", address, action: "add" }).then(() => { setParticipantAddress(""); setAddingParticipant(false); load(); }, (error: unknown) => showToast(messagingCommandError(error, "Could not add person")));
                  }}
                  placeholder="Phone number or email"
                  placeholderTextColor={theme.textTertiary}
                  style={[styles.addPersonInput, { color: theme.text, backgroundColor: theme.field }]}
                />
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel adding person" onPress={() => setAddingParticipant(false)} style={({ hovered, pressed }) => [styles.inlineIconAction, (hovered || pressed) && { backgroundColor: theme.rowHover }]}>
                  <Ionicons name="close" size={18} color={theme.icon} />
                </Pressable>
              </View>
            )}
          </Section>
        )}

        {gallery.length > 0 && (
          <Section
            title="Shared media"
            divider={theme.divider}
            labelColor={theme.textSecondary}
            action={gallery.length > GRID_MAX ? { label: `See all ${gallery.length}`, onPress: () => openLightbox(gallery, 0) } : undefined}
          >
            {/* Fixed-pixel square tiles from the measured width: aspectRatio +
                percentage widths stagger under RN-web, so size them explicitly. */}
            <View style={styles.grid} onLayout={(e) => onGridLayout(e.nativeEvent.layout.width)}>
              {gallery.slice(0, GRID_MAX).map((item, index) => {
                const thumbnail = attachmentThumbnailUrl(item, tile);
                return (
                  <Pressable
                    key={item.guid}
                    accessibilityRole="button"
                    accessibilityLabel={item.isVideo ? `Open video ${index + 1}` : `Open photo ${index + 1}`}
                    style={[styles.tile, { width: tile, height: tile }]}
                    onPress={() => openLightbox(gallery, index)}
                  >
                    {thumbnail ? <Image source={{ uri: thumbnail }} style={styles.tileImg} contentFit="cover" /> : <MediaUnavailable />}
                    {item.isVideo && (
                      // Play badge sits on a fixed dark scrim over media thumbnails:
                      // theme-invariant by design.
                      <View style={styles.playBadge}>
                        <Ionicons name="play" size={14} color="#fff" />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Section>
        )}

        {summary && (
          <View style={[styles.section, { borderTopColor: theme.divider }]}>
            <ToggleRow
              icon="pin-outline"
              label="Pin conversation"
              value={pinned}
              theme={theme}
              onChange={(next) => {
                pinChat(summary, next);
                showToast(next ? "Pinned" : "Unpinned");
              }}
            />
            {/* TODO(signal-states): no mute command yet */}
            <ToggleRow icon="notifications-off-outline" label="Hide alerts" value={false} theme={theme} />
          </View>
        )}

        {/* CRM: a GROUP gets its own editable favorite/priority/tags/event
            section (ChatCrmSection, Convex-native, chat_guid-keyed). A DM
            has no CRM of its own; it INHERITS the linked person's (see
            server/map.ts's mapChat), shown read-only here with a pointer to
            the real edit surface, so there's never a second, driftable copy. */}
        {info.isGroup ? (
          <View style={[styles.section, { borderTopColor: theme.divider }]}>
            <ChatCrmSection chatGuid={guid} />
          </View>
        ) : (
          crm && <DmCrmNote crm={crm} />
        )}

        <View style={[styles.section, styles.danger, { borderTopColor: theme.divider }]}>
          {info.isGroup && (
            <Pressable
              accessibilityRole="button"
              style={({ hovered, pressed }) => [styles.dangerRow, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
              onPress={confirmLeave}
            >
              <Ionicons name="exit-outline" size={17} color={theme.destructive} />
              <Text style={[styles.dangerText, { color: theme.destructive, fontSize: type.body }]}>Leave conversation</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            style={({ hovered, pressed }) => [styles.dangerRow, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
            onPress={confirmDelete}
          >
            <Ionicons name="trash-outline" size={17} color={theme.destructive} />
            <Text style={[styles.dangerText, { color: theme.destructive, fontSize: type.body }]}>Delete conversation</Text>
          </Pressable>
          <Text style={[styles.dangerNote, { color: theme.textTertiary, fontSize: type.caption }]}>Removes it from Messages on all your devices.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  action,
  divider,
  labelColor,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  divider: string;
  labelColor: string;
  children: React.ReactNode;
}) {
  const type = useTypeRamp();
  return (
    <View style={[styles.section, { borderTopColor: divider }]}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: labelColor, fontSize: type.secondary }]}>{title}</Text>
        {action && (
          <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={6}>
            {({ hovered, pressed }) => (
              <Text style={[styles.sectionAction, { color: labelColor, fontSize: type.secondary }, (hovered || pressed) && { textDecorationLine: "underline" }]}>{action.label}</Text>
            )}
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  theme,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  theme: ThemeColors;
  onChange?: (next: boolean) => void;
}) {
  const type = useTypeRamp();
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={17} color={onChange ? theme.icon : theme.disabled} />
      <Text style={[styles.toggleLabel, { color: onChange ? theme.text : theme.disabled, fontSize: type.body }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={!onChange}
        onValueChange={onChange}
        trackColor={{ true: theme.text, false: theme.switchOff }}
        thumbColor={value ? theme.surface : "#FFFFFF"}
        {...({ activeThumbColor: theme.surface } as object)}
      />
    </View>
  );
}

/**
 * A DM's read-only inherited CRM, sourced from `ChatSummary.crm` (resolved
 * server-side by mapChat's inheritance rule, see server/map.ts). The favorite
 * star and tags show in the hero; this section carries priority and events.
 * No edit affordances on purpose: the contact card is the one editable copy.
 */
function DmCrmNote({ crm }: { crm: NonNullable<ChatSummary["crm"]> }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const events = crm.events ?? [];
  if (crm.priority === undefined && events.length === 0) return null;
  return (
    <View style={[styles.section, { borderTopColor: theme.divider }]}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textSecondary, fontSize: type.secondary }]}>CRM</Text>
        {crm.priority !== undefined && (
          <Text style={[styles.sectionAction, { color: theme.textSecondary, fontSize: type.secondary }]}>{`P${crm.priority}`}</Text>
        )}
      </View>
      {events.length > 0 && (
        <View style={styles.eventRow}>
          {events.map((e) => (
            <View key={e.id} style={[styles.tag, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
              <Ionicons name="calendar-outline" size={11} color={theme.textSecondary} />
              <Text style={[styles.tagText, { color: theme.textSecondary }]}>{e.name}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={{ color: theme.textTertiary, fontSize: type.caption, marginTop: 8 }}>
        Inherited from contact. Edit on their contact card.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingLeft: 20,
    paddingRight: 10,
  },
  paneHeaderTitle: { fontWeight: "600" },
  headerIcon: { alignItems: "center", borderRadius: 6, height: 28, justifyContent: "center", width: 28 },
  body: { paddingBottom: 20, paddingHorizontal: 20, paddingTop: 22 },
  inlineTextAction: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  inlineIconAction: { alignItems: "center", borderRadius: 6, justifyContent: "center", padding: 3 },
  hero: { alignItems: "center", marginBottom: 12 },
  titleRow: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 6 },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3, textAlign: "center" },
  subtitle: { marginTop: 2, textAlign: "center" },
  renameRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  renameInput: { borderRadius: 8, borderWidth: 1, flex: 1, fontSize: 15, paddingHorizontal: 10, paddingVertical: 6 },
  suggestTrigger: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 6 },
  identifyBlock: { marginTop: 8 },
  identityCard: { borderRadius: 10, gap: 5, padding: 12 },
  identityHead: { alignItems: "center", flexDirection: "row", gap: 7 },
  confidence: { fontSize: 11 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 12 },
  eventRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { alignItems: "center", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 4, height: 24, paddingHorizontal: 9 },
  tagText: { fontSize: 12, fontWeight: "500" },
  tagInput: { minWidth: 60, paddingVertical: 0 },
  section: { borderTopWidth: 1, marginTop: 18, paddingBottom: 6, paddingTop: 14 },
  sectionHead: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  sectionTitle: { fontWeight: "600" },
  sectionAction: { fontWeight: "500" },
  handleRow: { alignItems: "center", borderRadius: 6, flexDirection: "row", gap: 10, marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 5 },
  handleKind: { width: 46 },
  handleValue: { flex: 1, fontVariant: ["tabular-nums"] },
  memberRow: { borderRadius: 10, marginHorizontal: -8 },
  addPersonEditor: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 6 },
  addPersonInput: { borderRadius: 8, flex: 1, fontSize: 13, paddingHorizontal: 10, paddingVertical: 7 },
  toggleRow: { alignItems: "center", flexDirection: "row", gap: 10, paddingVertical: 7 },
  toggleLabel: { flex: 1 },
  danger: { paddingTop: 12 },
  dangerRow: { alignItems: "center", alignSelf: "flex-start", borderRadius: 6, flexDirection: "row", gap: 8, height: 30, marginHorizontal: -6, paddingHorizontal: 6 },
  dangerText: { fontWeight: "500" },
  dangerNote: { marginBottom: 6, marginLeft: 25 },
  grid: { columnGap: GRID_GAP, flexDirection: "row", flexWrap: "wrap", rowGap: GRID_GAP },
  tile: { borderRadius: 8, overflow: "hidden" },
  tileImg: { height: "100%", width: "100%" },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 11,
    bottom: 4,
    height: 22,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    width: 22,
  },
});
