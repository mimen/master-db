import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { type GuestListEvent, type Person, useAddToGuestList } from "@/lib/identity";
import { eventTile } from "@/lib/crm-summary";
import { type GuestContact, guestContact, guestRowState, isCompleteContact, withGuest } from "@/lib/guest-list";
import { showToast } from "@/lib/toast";
import { useTheme } from "@/hooks/use-theme";

export type GuestPerson = Pick<Person, "first_name" | "last_name" | "display_name" | "normalized_emails">;

/** One row per upcoming event: one tap adds a complete contact, otherwise the row opens a name and email form. */
export function GuestListRows({ person, events, onAdded }: {
  readonly person: GuestPerson;
  readonly events: readonly GuestListEvent[];
  readonly onAdded: (event: GuestListEvent) => void;
}) {
  const colors = useTheme();
  const addToGuestList = useAddToGuestList();
  const [draft, setDraft] = useState<GuestContact>(() => guestContact(person));
  const [formFor, setFormFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const emails = draft.email.trim() ? [...person.normalized_emails, draft.email.trim()] : person.normalized_emails;

  const submit = async (event: GuestListEvent, tierId: string) => {
    setBusy(event.eventId);
    try {
      const result = await addToGuestList({ eventId: event.eventId, tierId, ...draft });
      if (result.outcome === "confirmed") {
        onAdded(withGuest(event, tierId, draft.email));
        setFormFor(null);
        showToast(`Added to ${event.name}`);
      } else {
        showToast(result.outcome === "rejected" ? result.reason : "Not confirmed yet. Check the list before trying again.");
      }
    } catch {
      showToast("Couldn't add to the guest list. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="guest-list">
      {events.map((event, i) => {
        const state = guestRowState(event, emails, Date.now());
        const when = eventTile(event.startDate)?.long;
        const detail = state.kind === "open" ? `${when} · ${state.tier.remaining} left` : when;
        return (
          <View key={event.eventId} style={[styles.row, i > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.line}>
              <View style={styles.text}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{event.name}</Text>
                {detail ? <Text numberOfLines={1} style={[styles.detail, { color: colors.textSecondary }]}>{detail}</Text> : null}
              </View>
              {busy === event.eventId ? (
                <ActivityIndicator size="small" />
              ) : state.kind === "open" ? (
                formFor === event.eventId ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add to ${event.name} guest list`}
                    hitSlop={6}
                    onPress={() => (isCompleteContact(draft) ? void submit(event, state.tier.tierId) : setFormFor(event.eventId))}
                    style={({ hovered, pressed }) => [styles.add, { borderColor: colors.accent }, (hovered || pressed) && { backgroundColor: colors.rowHover }]}
                  >
                    <Ionicons name="add" size={13} color={colors.accent} />
                    <Text style={[styles.addText, { color: colors.accent }]}>GL</Text>
                  </Pressable>
                )
              ) : (
                <View style={styles.status}>
                  {state.kind === "on-list" ? <Ionicons name="checkmark-circle" size={14} color={colors.accent} /> : null}
                  <Text style={[styles.detail, { color: colors.textSecondary }]}>
                    {state.kind === "on-list" ? "On list" : state.kind === "full" ? "Full" : "Closed"}
                  </Text>
                </View>
              )}
            </View>
            {formFor === event.eventId && state.kind === "open" ? (
              <View style={styles.form}>
                {(["firstName", "lastName", "email"] as const).map((field) => (
                  <TextInput
                    key={field}
                    accessibilityLabel={FIELD_LABELS[field]}
                    placeholder={FIELD_LABELS[field]}
                    placeholderTextColor={colors.textTertiary}
                    value={draft[field]}
                    onChangeText={(value) => setDraft((d) => ({ ...d, [field]: value }))}
                    autoCapitalize={field === "email" ? "none" : "words"}
                    keyboardType={field === "email" ? "email-address" : "default"}
                    style={[styles.input, { backgroundColor: colors.field, color: colors.text }]}
                  />
                ))}
                <View style={styles.formActions}>
                  <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setFormFor(null)}>
                    <Text style={[styles.detail, { color: colors.textSecondary }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${draft.firstName || "guest"} to ${event.name}`}
                    disabled={!isCompleteContact(draft) || busy !== null}
                    hitSlop={6}
                    onPress={() => void submit(event, state.tier.tierId)}
                  >
                    <Text style={[styles.addText, { color: isCompleteContact(draft) ? colors.accent : colors.textTertiary }]}>Add to list</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const FIELD_LABELS = { firstName: "First name", lastName: "Last name", email: "Email" } as const;

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  line: { alignItems: "center", flexDirection: "row", gap: 10 },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: "600" },
  detail: { fontSize: 12, marginTop: 1 },
  add: { alignItems: "center", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 2, height: 24, paddingHorizontal: 9 },
  addText: { fontSize: 12.5, fontWeight: "600" },
  status: { alignItems: "center", flexDirection: "row", gap: 4 },
  form: { gap: 6, marginTop: 8 },
  input: { borderRadius: 8, fontSize: 13, paddingHorizontal: 10, paddingVertical: 6 },
  formActions: { alignItems: "center", flexDirection: "row", gap: 16, justifyContent: "flex-end", marginTop: 2 },
});
