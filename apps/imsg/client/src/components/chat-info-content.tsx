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
import type { Contact, GalleryItem } from "@shared/types";
import { formatAddress } from "@shared/address";
import { useTheme } from "@/hooks/use-theme";
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
}

export function ChatInfoContent({ guid, onClose, onDeleted, showHeader = false }: ChatInfoContentProps) {
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
      <Text style={[styles.paneHeaderTitle, { color: theme.text }]}>Details</Text>
      <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close details">
        <Ionicons name="close" size={22} color={theme.textSecondary} />
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
          ) : (
            <Pressable style={styles.titleRow} onPress={() => setRenaming(true)}>
              <Text style={[styles.title, { color: theme.text }]}>
                {info.displayName || `${info.participants.length} people`}
              </Text>
              <Ionicons name="pencil" size={16} color={theme.textSecondary} />
            </Pressable>
          )
        ) : (
          <Text style={[styles.title, { color: theme.text }]}>
            {info.participants[0]?.name ??
              (info.participants[0]?.address ? formatAddress(info.participants[0].address) : "Details")}
          </Text>
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
                onPress={() =>
                  router.push({ pathname: "/person", params: { address: p.address, name: p.name ?? "" } })
                }
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
    height: 52,
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
