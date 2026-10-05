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
import { HOVER_DIM, Radii, Type } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { CrmEventsEditor } from "./crm-events-editor";
import { crmSummary } from "@/lib/crm-summary";
import { CrmDisclosure, FAVORITE_GOLD, NO_PRIORITY, PRIORITY_OPTIONS } from "./person-crm-section";
import { Dropdown } from "./ui/dropdown";

export interface ChatCrmSectionProps {
  chatGuid: string;
}


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
    setFavorite({ chatGuid, is_favorite: !isFavorite }).catch(() => showToast("Couldn't update the favorite. Try again."));
  };

  const choosePriority = (value: Priority) => {
    setPriority({ chatGuid, priority: value === NO_PRIORITY ? null : value }).catch(() => showToast("Couldn't update the priority. Try again."));
  };

  const submitTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    setAddingTag(true);
    try {
      await addTag({ chatGuid, tag });
      setTagInput("");
    } catch {
      showToast("Couldn't add the tag. Try again.");
    } finally {
      setAddingTag(false);
    }
  };

  return (
    <CrmDisclosure summary={crmSummary({ isFavorite, priority, tagCount: crm.tags.length, eventCount: crm.events.length })}>
      <View style={styles.section}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-selected={isFavorite}
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
                { color: isFavorite ? theme.text : theme.textSecondary },
              ]}
            >
              Favorite
            </Text>
          </Pressable>

          <Dropdown
            label="Priority"
            value={priority ?? NO_PRIORITY}
            options={PRIORITY_OPTIONS}
            onChange={choosePriority}
            style={styles.priorityField}
          />
        </View>

        <View style={styles.tagRow}>
          {crm.tags.map((tag) => (
            <View key={tag} style={[styles.tagChip, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.tagLabel, { color: theme.text }]}>{tag}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
                hitSlop={6}
                onPress={() => removeTag({ chatGuid, tag }).catch(() => showToast("Couldn't remove the tag. Try again."))}
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
          onUnlink={(linkId) => unlinkEvent({ linkId }).catch(() => showToast("Couldn't unlink the event. Try again."))}
        />
      </View>
    </CrmDisclosure>
  );
}

const styles = StyleSheet.create({
  section: { width: "100%", marginTop: 8, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  favoriteBtn: { flexDirection: "row", alignItems: "center", borderRadius: 6, gap: 6, margin: -4, padding: 4 },
  favoriteLabel: { fontSize: Type.secondary, fontWeight: "600" },
  priorityField: { width: 132 },
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
