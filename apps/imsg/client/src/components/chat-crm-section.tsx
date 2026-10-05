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
import { useColorScheme } from "@/hooks/use-color-scheme";
import { HOVER_DIM, PRESS_DIM, Type } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { CrmEventsEditor } from "./crm-events-editor";
import { crmSummary } from "@/lib/crm-summary";
import { CrmDisclosure } from "./person-crm-section";

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = {
  light: { text: "#17171A", textSecondary: "#55555C", textTertiary: "#64646B", icon: "#5E5E66", rowHover: "rgba(0,0,0,0.04)", chipBg: "#FFFFFF", chipBorder: "rgba(0,0,0,0.13)", onText: "#FFFFFF" },
  dark: { text: "#EDEDEF", textSecondary: "#A6A6AD", textTertiary: "#8F8F96", icon: "#97979E", rowHover: "rgba(255,255,255,0.045)", chipBg: "#1C1C1F", chipBorder: "rgba(255,255,255,0.12)", onText: "#141416" },
} as const;

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
  const signal = SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
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
    const next = priority === value ? null : value;
    setPriority({ chatGuid, priority: next }).catch(() => showToast("Couldn't update the priority. Try again."));
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
            style={({ hovered, pressed }) => [styles.favoriteBtn, (hovered || pressed) && { backgroundColor: signal.rowHover }]}
          >
            <Ionicons
              name={isFavorite ? "star" : "star-outline"}
              size={19}
              color={isFavorite ? signal.text : signal.icon}
            />
            <Text
              style={[
                styles.favoriteLabel,
                { color: isFavorite ? signal.text : signal.textSecondary },
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
                  aria-checked={selected}
                  onPress={() => choosePriority(opt.value)}
                  style={({ hovered, pressed }) => [
                    styles.priorityPill,
                    { backgroundColor: selected ? signal.text : hovered || pressed ? signal.rowHover : signal.chipBg, borderColor: selected ? signal.text : signal.chipBorder },
                    selected && (hovered || pressed) && { opacity: pressed ? PRESS_DIM : HOVER_DIM },
                  ]}
                >
                  <Text
                    style={[styles.priorityLabel, { color: selected ? signal.onText : signal.textSecondary }]}
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
            <View key={tag} style={[styles.tagChip, { backgroundColor: signal.chipBg, borderColor: signal.chipBorder }]}>
              <Text style={[styles.tagLabel, { color: signal.textSecondary }]}>{tag}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
                hitSlop={6}
                onPress={() => removeTag({ chatGuid, tag }).catch(() => showToast("Couldn't remove the tag. Try again."))}
              >
                {({ hovered, pressed }) => <Ionicons name="close" size={12} color={hovered || pressed ? signal.text : signal.textTertiary} />}
              </Pressable>
            </View>
          ))}
          <View style={[styles.tagInputWrap, { borderColor: signal.chipBorder }]}>
            <TextInput
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={submitTag}
              placeholder="Add tag"
              placeholderTextColor={signal.textTertiary}
              returnKeyType="done"
              style={[styles.tagInput, { color: signal.text }]}
            />
            {addingTag ? (
              <ActivityIndicator size="small" />
            ) : (
              tagInput.trim().length > 0 && (
                <Pressable accessibilityRole="button" accessibilityLabel="Add tag" hitSlop={6} onPress={submitTag} style={({ hovered, pressed }) => [(hovered || pressed) && { opacity: HOVER_DIM }]}>
                  <Ionicons name="add-circle" size={16} color={signal.text} />
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
  favoriteLabel: { fontSize: Type.secondary, fontWeight: "500" },
  priorityGroup: { flexDirection: "row", gap: 4 },
  priorityPill: { borderRadius: 999, borderWidth: 1, height: 24, justifyContent: "center", paddingHorizontal: 9 },
  priorityLabel: { fontSize: 12, fontWeight: "500" },
  tagRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagChip: { alignItems: "center", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, height: 24, paddingHorizontal: 9 },
  tagLabel: { fontSize: 12, fontWeight: "500" },
  tagInputWrap: { alignItems: "center", borderRadius: 999, borderStyle: "dashed", borderWidth: 1, flexDirection: "row", gap: 4, height: 24, minWidth: 90, paddingHorizontal: 9 },
  tagInput: { fontSize: 12, minWidth: 60, paddingVertical: 0 },
});
