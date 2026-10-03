import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api, attachmentThumbnailUrl, attachmentUrl } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { markChatUnread, pinChat } from "@/lib/chat-actions";
import { useLightbox } from "@/lib/lightbox";
import { showToast } from "@/lib/toast";
import type { ChatSummary, Contact, ContactSuggestion, GalleryItem } from "@shared/types";
import { formatAddress } from "@shared/address";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { useType } from "@/hooks/use-type";
import { PRESS_DIM, Type } from "@/constants/theme";
import { useAiStatus } from "@/hooks/use-ai";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { ChatAvatar, GroupPhotoAvatar, PersonAvatar } from "./avatar";
import { ChatCrmSection } from "./chat-crm-section";
import { CenteredSpinner } from "./empty-state";
import { ListRow } from "./list-row";
import { FAVORITE_GOLD } from "./person-crm-section";

const GRID_GAP = 5;

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
  const visual = useTriageTheme();
  const type = useType();
  const showSheet = useActionSheet();
  const openLightbox = useLightbox();
  const chats = useChatDirectory();
  const [info, setInfo] = useState<{
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  } | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
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

  const identify = () => {
    setIdentifying(true);
    api
      .aiIdentify(guid)
      .then(setIdentity)
      .catch(() => showToast("Couldn't identify"))
      .finally(() => setIdentifying(false));
  };

  const load = useCallback(() => {
    if (!guid) return;
    api.chatInfo(guid).then((i) => {
      setInfo(i);
      setName(i.displayName ?? "");
    }).catch(() => undefined);
    api.gallery(guid).then(setGallery).catch(() => undefined);
  }, [guid]);

  useEffect(load, [load]);

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.paneHeaderTitle, { color: theme.text, fontSize: type.title }]}>Details</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        hitSlop={8}
        accessibilityLabel="Close details"
        style={({ hovered, pressed }) => [styles.headerIcon, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
      >
        {({ hovered, pressed }) => <Ionicons name="close" size={20} color={hovered || pressed ? theme.text : theme.textSecondary} />}
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
        .catch(() => showToast("Rename failed"));
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
            api.participant(guid, p.address, "remove").then(load).catch(() => showToast(`Couldn't remove ${p.name ?? formatAddress(p.address)}. Try again.`)),
        },
      ],
    });
  };

  const galleryMedia = gallery.map((g) => ({ url: attachmentUrl(g.guid), isVideo: g.isVideo }));
  const summary = chats?.find((c) => c.guid === guid) ?? null;
  const peer = info.isGroup ? null : info.participants[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView
        style={[
          { flex: 1 },
          Platform.OS === "web" ? ({ scrollbarGutter: "stable" } as object) : null,
        ]}
        contentContainerStyle={{ padding: 16 }}
      >
        <View style={styles.hero}>
          {summary ? <ChatAvatar chat={summary} size={72} /> : peer ? <PersonAvatar address={peer.address} name={peer.name ?? formatAddress(peer.address)} size={72} /> : <GroupPhotoAvatar guid={guid} size={72} />}
        </View>
        {info.isGroup ? (
          renaming ? (
            <View>
              <View style={styles.renameRow}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  onSubmitEditing={saveName}
                  placeholder="Group name"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.renameInput, { color: theme.text, borderColor: theme.divider }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save name"
                  onPress={saveName}
                  style={({ hovered, pressed }) => [styles.inlineTextAction, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
                >
                  {({ hovered, pressed }) => <Text style={{ color: hovered || pressed ? theme.text : theme.accent, fontSize: Type.body, fontWeight: "600" }}>Save</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <View>
              <Pressable accessibilityRole="button" accessibilityLabel="Rename group" style={styles.titleRow} onPress={() => setRenaming(true)}>
                <Text style={[styles.title, { color: theme.text, fontSize: type.title, fontWeight: "600" }]}>
                  {info.displayName || `${info.participants.length} people`}
                </Text>
                <Ionicons name="pencil" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>
          )
        ) : (
          <View>
            <Text style={[styles.title, { color: theme.text, fontSize: type.title }]}>
              {info.participants[0]?.name ??
                (info.participants[0]?.address ? formatAddress(info.participants[0].address) : "Details")}
            </Text>
            {aiStatus?.suggestions && !info.participants[0]?.name && (
              <View style={styles.identifyBlock}>
                {identity ? (
                  <View style={[styles.identityCard, { backgroundColor: theme.backgroundElement }]}>
                    <View style={styles.identityHead}>
                      <Ionicons name="sparkles" size={13} color={theme.accent} />
                      <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600", flex: 1 }}>
                        {identity.name ?? "Couldn't place them"}
                      </Text>
                      <Text style={[styles.confidence, { color: theme.textSecondary }]}>
                        {identity.confidence}
                      </Text>
                    </View>
                    <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 18 }}>
                      {identity.reasoning}
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={identify}
                    disabled={identifying}
                    style={styles.suggestTrigger}
                    hitSlop={6}
                  >
                    {identifying ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Ionicons name="help-circle-outline" size={15} color={theme.accent} />
                    )}
                    <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "500" }}>
                      {identifying ? "Looking…" : "Who is this?"}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {summary && (
          <View style={styles.quickRow}>
            {([
              {
                icon: (summary.flags.pinned ? "pin" : "pin-outline") as keyof typeof Ionicons.glyphMap,
                label: summary.flags.pinned ? "Unpin" : "Pin",
                onPress: () => {
                  pinChat(summary, !summary.flags.pinned);
                  showToast(summary.flags.pinned ? "Unpinned" : "Pinned");
                },
              },
              {
                icon: "mail-unread-outline" as keyof typeof Ionicons.glyphMap,
                label: "Mark unread",
                onPress: () => {
                  markChatUnread(summary);
                  showToast("Marked unread");
                  onClose();
                },
              },
            ] as const).map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                style={({ hovered, pressed }) => [styles.quickAction, { backgroundColor: hovered || pressed ? theme.backgroundSelected : theme.backgroundElement }]}
                onPress={a.onPress}
              >
                <Ionicons name={a.icon} size={15} color={theme.text} />
                <Text style={{ color: theme.text, fontSize: Type.secondary, fontWeight: "600" }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {info.isGroup && (
          <Text style={[styles.section, { color: theme.textSecondary }]}>
            {`${info.participants.length} people`}
          </Text>
        )}
        <View style={[styles.card, !info.isGroup && styles.cardGap, { backgroundColor: visual.card, boxShadow: `0 1px 3px ${visual.cardShadow}` } as object]}>
          {info.participants.map((p, i) => (
            <View key={p.address}>
              {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.divider }]} />}
              <ListRow
                paddingHorizontal={14}
                minHeight={56}
                titleWeight="400"
                onPress={() => {
                  const nm = p.name ?? formatAddress(p.address);
                  if (onOpenPerson) onOpenPerson(p.address, nm);
                  else router.push({ pathname: "/person", params: { address: p.address, name: p.name ?? "" } });
                }}
                onLongPress={info.isGroup ? () => removeParticipant(p) : undefined}
                leading={<PersonAvatar address={p.address} name={p.name ?? formatAddress(p.address)} size={40} />}
                title={p.name ?? formatAddress(p.address)}
                subtitle={p.name ? formatAddress(p.address) : undefined}
                trailing={<Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />}
              />
            </View>
          ))}
          {info.isGroup && (addingParticipant ? (
            <View style={[styles.addPersonEditor, { borderTopColor: visual.hairline }]}>
              <TextInput
                autoFocus
                value={participantAddress}
                onChangeText={setParticipantAddress}
                onSubmitEditing={() => {
                  const address = participantAddress.trim();
                  if (!address) return;
                  void api.participant(guid, address, "add").then(() => { setParticipantAddress(""); setAddingParticipant(false); load(); }, () => showToast("Could not add person"));
                }}
                placeholder="Phone number or email"
                placeholderTextColor={theme.textSecondary}
                style={[styles.addPersonInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel adding person" onPress={() => setAddingParticipant(false)} style={({ hovered, pressed }) => [styles.inlineIconAction, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}>{({ hovered, pressed }) => <Ionicons name="close" size={18} color={hovered || pressed ? theme.text : theme.textSecondary} />}</Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setAddingParticipant(true)} style={[styles.addPersonRow, { borderTopColor: visual.hairline }]}>
              <View style={[styles.addPersonIcon, { backgroundColor: "rgba(0,122,255,0.10)" }]}><Ionicons name="person-add" size={15} color={theme.accent} /></View>
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "500" }}>Add person</Text>
            </Pressable>
          ))}
        </View>

        {/* CRM: a GROUP gets its own editable favorite/priority/tags/event
            section (ChatCrmSection — Convex-native, chat_guid-keyed). A DM
            has no CRM of its own; it INHERITS the linked person's (see
            server/map.ts's mapChat) — shown read-only here with a pointer to
            the real edit surface, so there's never a second, driftable copy. */}
        {info.isGroup ? (
          <ChatCrmSection chatGuid={guid} />
        ) : (
          summary?.crm && <DmCrmNote crm={summary.crm} />
        )}

        {gallery.length > 0 && (
          <>
            <Text style={[styles.section, { color: theme.textSecondary }]}>Photos and videos</Text>
            {/* Fixed-pixel square tiles from the measured width — aspectRatio +
                percentage widths stagger under RN-web, so size them explicitly. */}
            <View style={styles.grid} onLayout={(e) => onGridLayout(e.nativeEvent.layout.width)}>
              {gallery.map((item, index) => {
                const tileSize = gridWidth > 0 ? (gridWidth - 2 * GRID_GAP) / 3 : 0;
                return (
                <Pressable
                  key={item.guid}
                  accessibilityRole="button"
                  accessibilityLabel={item.isVideo ? `Open video ${index + 1}` : `Open photo ${index + 1}`}
                  style={{ width: tileSize, height: tileSize }}
                  onPress={() => openLightbox(galleryMedia, index)}
                >
                  <Image
                    source={{ uri: item.isVideo ? attachmentUrl(item.guid) : attachmentThumbnailUrl(item.guid, tileSize) }}
                    style={styles.tileImg}
                    contentFit="cover"
                  />
                  {item.isVideo && (
                    // Play badge sits on a fixed dark scrim over media thumbnails —
                    // theme-invariant by design, not a theme.onAccent site.
                    <View style={styles.playBadge}>
                      <Ionicons name="play" size={14} color="#fff" />
                    </View>
                  )}
                </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View style={[styles.card, styles.cardGap, { backgroundColor: visual.card, boxShadow: `0 1px 3px ${visual.cardShadow}` } as object]}>
          {info.isGroup && (
            <>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.dangerRow, pressed && { opacity: PRESS_DIM }]}
                onPress={() =>
                  showSheet({
                    title: "Leave this conversation? You'll stop getting its messages.",
                    actions: [
                      {
                        label: "Leave conversation",
                        destructive: true,
                        onPress: () =>
                          api.leaveGroup(guid).then(() => onClose()).catch(() => showToast("Couldn't leave the conversation. Try again.")),
                      },
                    ],
                  })
                }
              >
                <Text style={styles.actionDanger}>Leave conversation</Text>
              </Pressable>
              <View style={[styles.rowDivider, { backgroundColor: theme.divider, marginLeft: 0 }]} />
            </>
          )}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: PRESS_DIM }]}
            onPress={() =>
              showSheet({
                title: "Delete this conversation? This can't be undone.",
                actions: [
                  {
                    label: "Delete conversation",
                    destructive: true,
                    onPress: () =>
                      api
                        .deleteChat(guid)
                        .then(() => onDeleted())
                        .catch(() => showToast("Couldn't delete the conversation. Try again.")),
                  },
                ],
              })
            }
          >
            <Text style={styles.actionDanger}>Delete conversation</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * A DM's read-only inherited CRM — favorite star, priority badge, tag/event
 * chips, all sourced from `ChatSummary.crm` (already resolved server-side by
 * mapChat's inheritance rule, see server/map.ts). No edit affordances here on
 * purpose: the person's own contact screen is the one editable copy.
 */
function DmCrmNote({ crm }: { crm: NonNullable<ChatSummary["crm"]> }) {
  const theme = useTheme();
  const hasChips = (crm.tags?.length ?? 0) > 0 || (crm.events?.length ?? 0) > 0;
  return (
    <View style={dmCrmStyles.wrap}>
      <View style={dmCrmStyles.row}>
        {crm.is_favorite && (
          <View style={dmCrmStyles.item}>
            <Ionicons name="star" size={15} color={FAVORITE_GOLD} />
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Favorite</Text>
          </View>
        )}
        {crm.priority !== undefined && (
          <View style={[dmCrmStyles.priorityPill, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.text, fontSize: 11, fontWeight: "600" }}>{`P${crm.priority}`}</Text>
          </View>
        )}
      </View>
      {hasChips && (
        <View style={dmCrmStyles.chipRow}>
          {crm.tags?.map((tag) => (
            <View key={tag} style={[dmCrmStyles.chip, { backgroundColor: theme.backgroundElement }]}>
              <Text style={{ color: theme.text, fontSize: 12 }}>{tag}</Text>
            </View>
          ))}
          {crm.events?.map((e) => (
            <View key={e.id} style={[dmCrmStyles.chip, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="calendar-outline" size={11} color={theme.textSecondary} />
              <Text style={{ color: theme.text, fontSize: 12 }}>{e.name}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={[dmCrmStyles.caption, { color: theme.textSecondary }]}>
        Inherited from contact — edit on their contact card.
      </Text>
    </View>
  );
}

const dmCrmStyles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 20 },
  row: { alignItems: "center", flexDirection: "row", gap: 12 },
  item: { alignItems: "center", flexDirection: "row", gap: 6 },
  priorityPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  caption: { fontSize: 11 },
});

const styles = StyleSheet.create({
  paneHeader: {
    alignItems: "center",
    borderBottomWidth: 0.5,
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  paneHeaderTitle: { fontWeight: "600" },
  headerIcon: { alignItems: "center", borderRadius: 7, height: 28, justifyContent: "center", width: 28 },
  inlineTextAction: { borderRadius: 6, marginHorizontal: -5, marginVertical: -3, paddingHorizontal: 5, paddingVertical: 3 },
  inlineIconAction: { alignItems: "center", borderRadius: 6, justifyContent: "center", margin: -3, padding: 3 },
  hero: { alignItems: "center", marginBottom: 12, marginTop: 4 },
  quickRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  quickAction: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 6, height: 32, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 8 },
  title: { fontWeight: "600", textAlign: "center" },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  renameInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 18 },
  suggestTrigger: { flexDirection: "row", alignItems: "center", gap: 6 },
  addPersonRow: { alignItems: "center", borderTopWidth: 0.5, flexDirection: "row", gap: 10, minHeight: 46, paddingHorizontal: 12 },
  addPersonIcon: { alignItems: "center", borderRadius: 15, height: 30, justifyContent: "center", width: 30 },
  addPersonEditor: { alignItems: "center", borderTopWidth: 0.5, flexDirection: "row", gap: 8, minHeight: 50, paddingHorizontal: 10 },
  addPersonInput: { borderRadius: 9, flex: 1, fontSize: 13, paddingHorizontal: 10, paddingVertical: 7 },
  identifyBlock: { marginTop: 8 },
  identityCard: { borderRadius: 12, padding: 12, gap: 5 },
  identityHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  confidence: { fontSize: 11 },
  section: { fontSize: 12, fontWeight: "600", marginTop: 18, marginBottom: 6 },
  card: { borderRadius: 10, overflow: "hidden" },
  cardGap: { marginTop: 18 },
  rowDivider: { height: 0.5, marginLeft: 51 },
  dangerRow: { alignItems: "flex-start", justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  // Intentionally NOT theme.destructive: that literal is the iOS system-red
  // LIGHT variant, and it's already correct in light mode. Swapping to the
  // themed token would flip dark mode to #FF453A, which is outside this
  // sweep's two authorized visual changes (accent + #FF453A→light-mode-red).
  actionDanger: { color: "#FF3B30", fontSize: 13, fontWeight: "500" },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: GRID_GAP, rowGap: GRID_GAP, marginTop: 2 },
  tileImg: { width: "100%", height: "100%", borderRadius: 6 },
  playBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
