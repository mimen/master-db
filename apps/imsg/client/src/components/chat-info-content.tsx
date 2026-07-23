import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { api, attachmentUrl, avatarUrl } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { archiveChat, markChatUnread, pinChat } from "@/lib/chat-actions";
import { getChats } from "@/lib/chat-store";
import { useLightbox } from "@/lib/lightbox";
import { showToast } from "@/lib/toast";
import type { Contact, ContactSuggestion, GalleryItem } from "@shared/types";
import { formatAddress } from "@shared/address";
import { useTheme } from "@/hooks/use-theme";
import { useAiStatus } from "@/hooks/use-ai";
import { initials } from "@/lib/format";

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
  const showSheet = useActionSheet();
  const openLightbox = useLightbox();
  const [info, setInfo] = useState<{
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  } | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [gridWidth, setGridWidth] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const aiStatus = useAiStatus();
  const [nameIdeas, setNameIdeas] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [namesDismissed, setNamesDismissed] = useState(false);
  const [identity, setIdentity] = useState<ContactSuggestion | null>(null);
  const [identifying, setIdentifying] = useState(false);

  const suggestNames = () => {
    setSuggesting(true);
    api
      .aiGroupNames(guid)
      .then((r) => setNameIdeas(r.names))
      .catch(() => showToast("Couldn't suggest names"))
      .finally(() => setSuggesting(false));
  };

  const applyName = (newName: string) => {
    setNamesDismissed(true);
    api.renameGroup(guid, newName).then(load).catch(() => showToast("Rename failed"));
  };

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

  // Proactively suggest names once when opening a group's details.
  useEffect(() => {
    if (aiStatus?.suggestions && info?.isGroup && nameIdeas.length === 0 && !namesDismissed) {
      suggestNames();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiStatus?.suggestions, info?.isGroup]);

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.paneHeaderTitle, { color: theme.text }]}>Details</Text>
      <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close details">
        <Ionicons name="close" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  ) : null;

  if (!guid || !info) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <View style={[styles.center, { backgroundColor: theme.background }]}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  const saveName = () => {
    setRenaming(false);
    if (name.trim() && name !== info.displayName) {
      api.renameGroup(guid, name.trim()).then(load).catch(() => showToast("Rename failed"));
    }
  };

  const removeParticipant = (p: Contact) => {
    showSheet({
      title: p.name,
      actions: [
        {
          label: "Remove from Conversation",
          destructive: true,
          onPress: () =>
            api.participant(guid, p.address, "remove").then(load).catch(() => showToast("Failed")),
        },
      ],
    });
  };

  const galleryMedia = gallery.map((g) => ({ url: attachmentUrl(g.guid), isVideo: g.isVideo }));
  const summary = getChats()?.find((c) => c.guid === guid) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
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
                label: "Unread",
                onPress: () => {
                  markChatUnread(summary);
                  showToast("Marked unread");
                  onClose();
                },
              },
              {
                icon: (summary.flags.archived
                  ? "arrow-undo-outline"
                  : "archive-outline") as keyof typeof Ionicons.glyphMap,
                label: summary.flags.archived ? "Unarchive" : "Archive",
                onPress: () => {
                  archiveChat(summary, !summary.flags.archived);
                  showToast(summary.flags.archived ? "Unarchived" : "Archived");
                  onClose();
                },
              },
            ] as const).map((a) => (
              <Pressable key={a.label} style={styles.quickAction} onPress={a.onPress}>
                <View style={[styles.quickIcon, { backgroundColor: theme.backgroundElement }]}>
                  <Ionicons name={a.icon} size={22} color={theme.text} />
                </View>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
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
                <Pressable onPress={saveName}>
                  <Text style={{ color: "#0A84FF", fontSize: 16, fontWeight: "600" }}>Save</Text>
                </Pressable>
              </View>
              {aiStatus?.suggestions && (
                <View style={styles.suggestBlock}>
                  <Pressable
                    onPress={suggestNames}
                    disabled={suggesting}
                    style={styles.suggestTrigger}
                    hitSlop={6}
                  >
                    {suggesting ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
                    )}
                    <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "500" }}>
                      {suggesting ? "Thinking…" : "Suggest names"}
                    </Text>
                  </Pressable>
                  {nameIdeas.length > 0 && (
                    <View style={styles.ideaRow}>
                      {nameIdeas.map((idea, i) => (
                        <Pressable
                          key={`${i}-${idea}`}
                          onPress={() => setName(idea)}
                          style={[
                            styles.ideaPill,
                            { backgroundColor: theme.backgroundElement, borderColor: theme.divider },
                          ]}
                        >
                          <Text style={{ color: theme.text, fontSize: 13 }}>{idea}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          ) : (
            <View>
              <Pressable style={styles.titleRow} onPress={() => setRenaming(true)}>
                <Text style={[styles.title, { color: theme.text }]}>
                  {info.displayName || `${info.participants.length} people`}
                </Text>
                <Ionicons name="pencil" size={16} color={theme.textSecondary} />
              </Pressable>
              {aiStatus?.suggestions && !namesDismissed && (suggesting || nameIdeas.length > 0) && (
                <View style={[styles.nameCard, { backgroundColor: theme.backgroundElement }]}>
                  <View style={styles.nameCardHead}>
                    <Ionicons name="sparkles-outline" size={13} color={theme.accent} />
                    <Text style={[styles.nameCardLabel, { color: theme.textSecondary }]}>
                      Suggested names
                    </Text>
                    <Pressable onPress={() => setNamesDismissed(true)} hitSlop={6}>
                      <Ionicons name="close" size={16} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                  {suggesting && nameIdeas.length === 0 ? (
                    <ActivityIndicator size="small" style={{ alignSelf: "flex-start", marginVertical: 4 }} />
                  ) : (
                    nameIdeas.map((idea, i) => (
                      <View key={`${i}-${idea}`} style={styles.nameIdeaRow}>
                        <Pressable style={{ flex: 1 }} onPress={() => { setName(idea); setRenaming(true); }}>
                          <Text style={{ color: theme.text, fontSize: 15 }}>{idea}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => applyName(idea)}
                          style={[styles.saveChip, { backgroundColor: theme.accent }]}
                          hitSlop={4}
                        >
                          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Save</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                  <Text style={[styles.nameCardHint, { color: theme.textSecondary }]}>
                    Tap a name to edit, or Save to apply.
                  </Text>
                </View>
              )}
            </View>
          )
        ) : (
          <View>
            <Text style={[styles.title, { color: theme.text }]}>
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

        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {info.participants.length} {info.participants.length === 1 ? "Person" : "People"}
        </Text>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          {info.participants.map((p, i) => (
            <View key={p.address}>
              {i > 0 && <View style={[styles.rowDivider, { backgroundColor: theme.divider }]} />}
              <Pressable
                style={styles.participant}
                onPress={() => {
                  const nm = p.name ?? formatAddress(p.address);
                  if (onOpenPerson) onOpenPerson(p.address, nm);
                  else router.push({ pathname: "/person", params: { address: p.address, name: p.name ?? "" } });
                }}
                onLongPress={info.isGroup ? () => removeParticipant(p) : undefined}
              >
                <View style={[styles.pAvatar, { backgroundColor: theme.background }]}>
                  <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "600" }}>
                    {initials(p.name ?? formatAddress(p.address))}
                  </Text>
                  <Image source={{ uri: avatarUrl(p.address) }} style={styles.pAvatarImg} contentFit="cover" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16 }}>
                    {p.name ?? formatAddress(p.address)}
                  </Text>
                  {p.name && (
                    <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{formatAddress(p.address)}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>

        <View style={[styles.card, styles.cardGap, { backgroundColor: theme.backgroundElement }]}>
          {info.isGroup && (
            <>
              <Pressable
                style={styles.dangerRow}
                onPress={() =>
                  showSheet({
                    title: "Leave this conversation?",
                    actions: [
                      {
                        label: "Leave Conversation",
                        destructive: true,
                        onPress: () =>
                          api.leaveGroup(guid).then(() => onClose()).catch(() => showToast("Failed")),
                      },
                    ],
                  })
                }
              >
                <Text style={styles.actionDanger}>Leave Conversation</Text>
              </Pressable>
              <View style={[styles.rowDivider, { backgroundColor: theme.divider, marginLeft: 0 }]} />
            </>
          )}
          <Pressable
            style={styles.dangerRow}
            onPress={() =>
              showSheet({
                title: "Delete this conversation? This cannot be undone.",
                actions: [
                  {
                    label: "Delete Conversation",
                    destructive: true,
                    onPress: () =>
                      api
                        .deleteChat(guid)
                        .then(() => onDeleted())
                        .catch(() => showToast("Delete failed")),
                  },
                ],
              })
            }
          >
            <Text style={styles.actionDanger}>Delete Conversation</Text>
          </Pressable>
        </View>

        {gallery.length > 0 && (
          <>
            <Text style={[styles.section, { color: theme.textSecondary }]}>Photos & Videos</Text>
            {/* Fixed-pixel square tiles from the measured width — aspectRatio +
                percentage widths stagger under RN-web, so size them explicitly. */}
            <View style={styles.grid} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
              {gallery.map((item, index) => {
                const tileSize = gridWidth > 0 ? (gridWidth - 2 * GRID_GAP) / 3 : 0;
                return (
                <Pressable
                  key={item.guid}
                  style={{ width: tileSize, height: tileSize }}
                  onPress={() => openLightbox(galleryMedia, index)}
                >
                  <Image source={{ uri: attachmentUrl(item.guid) }} style={styles.tileImg} contentFit="cover" />
                  {item.isVideo && (
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  paneHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 58,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  paneHeaderTitle: { fontSize: 16, fontWeight: "600" },
  quickRow: { flexDirection: "row", justifyContent: "center", gap: 28, marginBottom: 8 },
  quickAction: { alignItems: "center", gap: 6 },
  quickIcon: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  renameInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 18 },
  suggestBlock: { marginTop: 10, gap: 8 },
  suggestTrigger: { flexDirection: "row", alignItems: "center", gap: 6 },
  ideaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ideaPill: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 7 },
  nameCard: { marginTop: 10, borderRadius: 12, padding: 12, gap: 4 },
  nameCardHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  nameCardLabel: { flex: 1, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  nameIdeaRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  saveChip: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  nameCardHint: { fontSize: 11, marginTop: 4 },
  identifyBlock: { marginTop: 8 },
  identityCard: { borderRadius: 12, padding: 12, gap: 5 },
  identityHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  confidence: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 },
  section: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", marginTop: 22, marginBottom: 8 },
  card: { borderRadius: 12, overflow: "hidden" },
  cardGap: { marginTop: 18 },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  participant: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 9, minHeight: 56 },
  pAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  pAvatarImg: { ...StyleSheet.absoluteFillObject, borderRadius: 20 },
  dangerRow: { alignItems: "flex-start", justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  actionDanger: { color: "#FF3B30", fontSize: 16 },
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
