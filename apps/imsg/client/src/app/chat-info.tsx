import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { api, attachmentUrl, avatarUrl } from "@/lib/api";
import { useActionSheet } from "@/lib/action-sheet";
import { useLightbox } from "@/lib/lightbox";
import { showToast } from "@/lib/toast";
import type { Contact, GalleryItem } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";
import { initials } from "@/lib/format";

export default function ChatInfoScreen() {
  const theme = useTheme();
  const showSheet = useActionSheet();
  const openLightbox = useLightbox();
  const { guid } = useLocalSearchParams<{ guid: string }>();
  const [info, setInfo] = useState<{
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  } | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
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

  if (!guid || !info) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={{ padding: 16 }}>
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
        <Text style={[styles.title, { color: theme.text }]}>{info.participants[0]?.name ?? "Details"}</Text>
      )}

      <Text style={[styles.section, { color: theme.textSecondary }]}>
        {info.participants.length} {info.participants.length === 1 ? "Person" : "People"}
      </Text>
      {info.participants.map((p) => (
        <Pressable
          key={p.address}
          style={styles.participant}
          onLongPress={info.isGroup ? () => removeParticipant(p) : undefined}
        >
          <View style={[styles.pAvatar, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: "600" }}>
              {initials(p.name ?? p.address)}
            </Text>
            <Image source={{ uri: avatarUrl(p.address) }} style={styles.pAvatarImg} contentFit="cover" />
          </View>
          <View>
            <Text style={{ color: theme.text, fontSize: 16 }}>{p.name ?? p.address}</Text>
            {p.name && <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{p.address}</Text>}
          </View>
        </Pressable>
      ))}

      {info.isGroup && (
        <Pressable
          style={styles.action}
          onPress={() =>
            showSheet({
              title: "Leave this conversation?",
              actions: [
                {
                  label: "Leave Conversation",
                  destructive: true,
                  onPress: () =>
                    api.leaveGroup(guid).then(() => router.back()).catch(() => showToast("Failed")),
                },
              ],
            })
          }
        >
          <Ionicons name="exit-outline" size={20} color="#FF3B30" />
          <Text style={styles.actionDanger}>Leave Conversation</Text>
        </Pressable>
      )}

      <Pressable
        style={styles.action}
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
                    .then(() => {
                      router.dismissAll?.();
                      router.replace("/");
                    })
                    .catch(() => showToast("Delete failed")),
              },
            ],
          })
        }
      >
        <Ionicons name="trash-outline" size={20} color="#FF3B30" />
        <Text style={styles.actionDanger}>Delete Conversation</Text>
      </Pressable>

      {gallery.length > 0 && (
        <>
          <Text style={[styles.section, { color: theme.textSecondary }]}>Photos & Videos</Text>
          <FlatList
            data={gallery}
            keyExtractor={(g) => g.guid}
            numColumns={3}
            scrollEnabled={false}
            columnWrapperStyle={{ gap: 3 }}
            contentContainerStyle={{ gap: 3 }}
            renderItem={({ item, index }) => (
              <Pressable style={styles.tile} onPress={() => openLightbox(galleryMedia, index)}>
                <Image source={{ uri: attachmentUrl(item.guid) }} style={styles.tileImg} contentFit="cover" />
                {item.isVideo && (
                  <View style={styles.playBadge}>
                    <Ionicons name="play" size={14} color="#fff" />
                  </View>
                )}
              </Pressable>
            )}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  renameInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 18 },
  section: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", marginTop: 22, marginBottom: 8 },
  participant: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  pAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  pAvatarImg: { ...StyleSheet.absoluteFillObject, borderRadius: 20 },
  action: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  actionDanger: { color: "#FF3B30", fontSize: 16 },
  tile: { flex: 1 / 3, aspectRatio: 1 },
  tileImg: { width: "100%", height: "100%", borderRadius: 4 },
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
