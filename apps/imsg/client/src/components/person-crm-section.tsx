import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  type EventLink,
  type Priority,
  useAddTag,
  useLinkEvent,
  useRemoveTag,
  useSetFavorite,
  useSetPriority,
  useUnlinkEvent,
} from "@/lib/identity";
import { useTheme } from "@/hooks/use-theme";
import { HOVER_DIM, PRESS_DIM, Radii, Type } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { CrmEventsEditor } from "./crm-events-editor";

export interface PersonCrmSectionProps {
  personId: string;
  isFavorite: boolean;
  priority: Priority | undefined;
  tags: string[];
  events: EventLink[];
}

// P1–P5, one = highest — see convex/schema/identity/people.ts's docstring.
// NOT inverted, unlike Todoist's API.
const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 1, label: "P1" },
  { value: 2, label: "P2" },
  { value: 3, label: "P3" },
  { value: 4, label: "P4" },
  { value: 5, label: "P5" },
];

// iOS Contacts' own favorite-star gold — a fixed brand-adjacent color, same
// rationale as NETWORK_META's per-network brand colors and Colors.sms: a
// favorite star needs to read as "gold" in both light and dark, not shift
// with the app theme. Exported so the contacts list's trailing star
// (contacts-list-pane.tsx) matches exactly.
export const FAVORITE_GOLD = "#FFB800";

/**
 * The private CRM row: favorite toggle, priority pills, and a tag editor.
 * App-native metadata (convex/identity/crm.ts) that never syncs to Apple or
 * Airtable — see docs/plans/structured-names.html's "THE RULE: three
 * owners" and field matrix. Deliberately compact: this sits alongside the
 * person screen's name/actions/networks/conversations sections and
 * shouldn't dominate it, so it's one row (favorite + priority) plus a wrap
 * of tag chips, not its own titled card.
 */
export function PersonCrmSection({ personId, isFavorite, priority, tags, events }: PersonCrmSectionProps) {
  const theme = useTheme();
  const setFavorite = useSetFavorite();
  const setPriority = useSetPriority();
  const addTag = useAddTag();
  const removeTag = useRemoveTag();
  const linkEvent = useLinkEvent();
  const unlinkEvent = useUnlinkEvent();
  const [tagInput, setTagInput] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  const toggleFavorite = () => {
    setFavorite({ personId, is_favorite: !isFavorite }).catch(() => showToast("Failed to update favorite"));
  };

  // Tapping the already-selected priority pill clears it back to unset
  // (setPriority({priority: null}) — see crm.ts) rather than cycling through
  // values with no way back to "no opinion recorded."
  const choosePriority = (value: Priority) => {
    const next = priority === value ? null : value;
    setPriority({ personId, priority: next }).catch(() => showToast("Failed to update priority"));
  };

  const submitTag = async () => {
    const tag = tagInput.trim();
    if (!tag) return;
    setAddingTag(true);
    try {
      await addTag({ personId, tag });
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
        {tags.map((tag) => (
          <View key={tag} style={[styles.tagChip, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.tagLabel, { color: theme.text }]}>{tag}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
              hitSlop={6}
              onPress={() => removeTag({ personId, tag }).catch(() => showToast("Failed to remove tag"))}
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
        events={events}
        onLink={async (record) =>
          void (await linkEvent({ personId, airtable_event_id: record.record_id, event_name: record.name }))
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
