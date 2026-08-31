import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  type Priority,
  useAddChatTag,
  useChatCrm,
  useLinkEvent,
  useRemoveChatTag,
  useSetChatFavorite,
  useSetChatPriority,
  useUnlinkEvent,
} from "@/lib/identity";
import { useTheme } from "@/hooks/use-theme";
import { HOVER_DIM, PRESS_DIM, Radii, Type } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { CrmEventsEditor } from "./crm-events-editor";
import { FAVORITE_GOLD } from "./person-crm-section";

export interface ChatCrmSectionProps {
  chatGuid: string;
}

// Same P1–P5, one-is-highest convention as PersonCrmSection.
const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 1, label: "P1" },
  { value: 2, label: "P2" },
  { value: 3, label: "P3" },
  { value: 4, label: "P4" },
  { value: 5, label: "P5" },
];

/**
 * The private CRM row for a GROUP chat — the chat-side twin of
 * PersonCrmSection, same layout/behavior, targeting `chatGuid` instead of a
 * `personId`. GROUPS only: a DM has no CRM of its own (it inherits the
 * linked person's — see server/map.ts's mapChat and chat-info-content.tsx,
 * which renders a read-only inherited view for DMs instead of this
 * component). Reads live via `useChatCrm` (direct Convex query, not the
 * imsg server's REST chat list) so edits reflect immediately.
 */
export function ChatCrmSection({ chatGuid }: ChatCrmSectionProps) {
  const theme = useTheme();
  const crm = useChatCrm(chatGuid);
  const setFavorite = useSetChatFavorite();
  const setPriority = useSetChatPriority();
  const addTag = useAddChatTag();
  const removeTag = useRemoveChatTag();
  const linkEvent = useLinkEvent();
  const unlinkEvent = useUnlinkEvent();
  const [tagInput, setTagInput] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  if (!crm) return null;

  const isFavorite = crm.is_favorite ?? false;
  const priority = crm.priority;

  const toggleFavorite = () => {
    setFavorite({ chatGuid, is_favorite: !isFavorite }).catch(() => showToast("Failed to update favorite"));
  };

  const choosePriority = (value: Priority) => {
    const next = priority === value ? null : value;
    setPriority({ chatGuid, priority: next }).catch(() => showToast("Failed to update priority"));
  };

  const submitTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    setAddingTag(true);
    try {
      await addTag({ chatGuid, tag });
      setTagInput("");
    } catch {
      showToast("Failed to add tag");
    } finally {
      setAddingTag(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
          accessibilityState={{ selected: isFavorite }}
          hitSlop={8}
          onPress={toggleFavorite}
          style={({ hovered, pressed }) => [styles.favoriteBtn, hovered && !pressed && { backgroundColor: theme.backgroundElement }, pressed && { backgroundColor: theme.backgroundSelected }]}
        >
          <Ionicons
            name={isFavorite ? "star" : "star-outline"}
            size={19}
            color={isFavorite ? FAVORITE_GOLD : theme.textSecondary}
          />
          <Text
            style={[
              styles.favoriteLabel,
              { color: isFavorite ? FAVORITE_GOLD : theme.textSecondary },
            ]}
          >
            Favorite
          </Text>
        </Pressable>

        <View style={styles.priorityGroup} accessibilityRole="radiogroup" accessibilityLabel="Priority">
          {PRIORITY_OPTIONS.map((opt) => {
            const selected = priority === opt.value;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="radio"
                accessibilityLabel={`${opt.label} priority`}
                accessibilityState={{ checked: selected }}
                onPress={() => choosePriority(opt.value)}
                style={({ hovered, pressed }) => [
                  styles.priorityPill,
                  { backgroundColor: selected ? theme.text : hovered || pressed ? theme.backgroundSelected : theme.backgroundElement },
                  selected && (hovered || pressed) && { opacity: pressed ? PRESS_DIM : HOVER_DIM },
                ]}
              >
                <Text
                  style={[styles.priorityLabel, { color: selected ? theme.background : theme.textSecondary }]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.tagRow}>
        {crm.tags.map((tag) => (
          <View key={tag} style={[styles.tagChip, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.tagLabel, { color: theme.text }]}>{tag}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
              hitSlop={6}
              onPress={() => removeTag({ chatGuid, tag }).catch(() => showToast("Failed to remove tag"))}
            >
              {({ hovered, pressed }) => <Ionicons name="close" size={12} color={hovered || pressed ? theme.text : theme.textSecondary} />}
            </Pressable>
          </View>
        ))}
        <View style={[styles.tagInputWrap, { backgroundColor: theme.backgroundElement }]}>
          <TextInput
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={submitTag}
            placeholder="Add tag"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            style={[styles.tagInput, { color: theme.text }]}
          />
          {addingTag ? (
            <ActivityIndicator size="small" />
          ) : (
            tagInput.trim().length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel="Add tag" hitSlop={6} onPress={submitTag} style={({ hovered, pressed }) => [(hovered || pressed) && { opacity: HOVER_DIM }]}>
                <Ionicons name="add-circle" size={16} color={theme.accent} />
              </Pressable>
            )
          )}
        </View>
      </View>

      <CrmEventsEditor
        events={crm.events}
        onLink={async (record) =>
          void (await linkEvent({ chatGuid, airtable_event_id: record.record_id, event_name: record.name }))
        }
        onUnlink={(linkId) => unlinkEvent({ linkId }).catch(() => showToast("Failed to unlink event"))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { width: "100%", marginTop: 20, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  favoriteBtn: { flexDirection: "row", alignItems: "center", borderRadius: 6, gap: 6, margin: -4, padding: 4 },
  favoriteLabel: { fontSize: Type.secondary, fontWeight: "600" },
  priorityGroup: { flexDirection: "row", gap: 6 },
  priorityPill: { borderRadius: Radii.chip, paddingHorizontal: 10, paddingVertical: 5 },
  priorityLabel: { fontSize: Type.caption, fontWeight: "600" },
  tagRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagChip: {
    alignItems: "center",
    borderRadius: Radii.chip,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagLabel: { fontSize: Type.secondary },
  tagInputWrap: {
    alignItems: "center",
    borderRadius: Radii.chip,
    flexDirection: "row",
    gap: 4,
    minWidth: 90,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagInput: { fontSize: Type.secondary, minWidth: 60, paddingVertical: 2 },
});
