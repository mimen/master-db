import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import { useCreatePerson, useRenamePerson } from "@/lib/identity";
import { airtableRecordUrl } from "@/lib/airtable";
import { usePersonView } from "@/hooks/use-person-view";
import { useTheme } from "@/hooks/use-theme";
import { Spacing, Type } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { PersonAvatar } from "./avatar";
import { CenteredSpinner } from "./empty-state";
import { PersonConversationsList } from "./person-conversations-list";
import { PersonNetworksList } from "./person-networks-list";

export interface PersonContentProps {
  address: string;
  name?: string;
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
  /** When set, the header shows a back chevron with this label instead of a close X. */
  onBack?: () => void;
  backLabel?: string;
}

/** Editable state for the First/Last/Nickname/Organization/Display-override
 * form, shared by the not-found "Add Contact" flow and the found-person
 * rename affordance (person-content.tsx's two entry points into the same
 * structured-name edit surface — see convex/identity/mutations.ts's
 * createPerson/renamePerson, which both accept this same shape). `display`
 * is the optional override — left blank, the server derives "First Last". */
interface NameFormState {
  first: string;
  last: string;
  nickname: string;
  organization: string;
  display: string;
}

const EMPTY_NAME_FORM: NameFormState = { first: "", last: "", nickname: "", organization: "", display: "" };

type Theme = ReturnType<typeof useTheme>;

/**
 * Person-detail view, shared by the mobile /person modal and the desktop
 * contacts pane. Thin composition layer — data + matching lives in
 * usePersonView, the two list sections are their own components; this file
 * is just the header/avatar/actions chrome plus wiring.
 */
export function PersonContent({
  address,
  name,
  showHeader = false,
  onClose,
  onBack,
  backLabel = "Back",
}: PersonContentProps) {
  const theme = useTheme();
  const { result, sortedChats, lastContactedAt, canCall, handleMessage, handleCall, openChat } = usePersonView(
    address,
    name,
  );
  const createPerson = useCreatePerson();
  const renamePerson = useRenamePerson();
  const [creating, setCreating] = useState(false);
  const [addForm, setAddForm] = useState<NameFormState>({ ...EMPTY_NAME_FORM, display: name ?? "" });
  const [editingName, setEditingName] = useState(false);
  const [nameForm, setNameForm] = useState<NameFormState>(EMPTY_NAME_FORM);
  const [saving, setSaving] = useState(false);

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel={backLabel} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={theme.accent} />
          <Text style={{ color: theme.accent, fontSize: 15 }}>{backLabel}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.paneHeaderTitle, { color: theme.textSecondary }]}>Profile</Text>
      )}
      {onClose && !onBack && (
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close contact">
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  ) : null;

  if (result === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <CenteredSpinner />
      </View>
    );
  }

  if (!result.found) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {header}
        <View style={styles.container}>
          <View style={styles.avatarWrap}>
            <PersonAvatar address={address} name={name || address} size={96} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{name || address}</Text>
          <Text style={[styles.statusLine, { color: theme.textSecondary }]}>{address}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 14, marginTop: 16, marginBottom: 16 }}>
            No linked contact found.
          </Text>
          <NameFormFields
            value={addForm}
            onChange={(patch) => setAddForm((f) => ({ ...f, ...patch }))}
            theme={theme}
          />
          <Pressable
            disabled={creating}
            style={[styles.addButton, { backgroundColor: theme.backgroundElement }]}
            onPress={async () => {
              setCreating(true);
              try {
                // Blank = "no info for this field" here (a fresh contact,
                // not an edit of known data) — every field collapses to
                // undefined rather than an explicit clear.
                await createPerson({
                  handle: address,
                  display_name: addForm.display.trim() || undefined,
                  first_name: addForm.first.trim() || undefined,
                  last_name: addForm.last.trim() || undefined,
                  nickname: addForm.nickname.trim() || undefined,
                  organization: addForm.organization.trim() || undefined,
                });
                showToast("Contact added");
                // So the inbox picks up the new name/known status right away
                // instead of waiting for the server's next mirror tick.
                void api.refreshIdentity().catch(() => undefined);
              } catch {
                showToast("Failed to add contact");
              } finally {
                setCreating(false);
              }
            }}
          >
            {creating ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: theme.accent, fontSize: Type.body, fontWeight: "600" }}>+ Add Contact</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  const { person, identities } = result;
  const airtableId = person.airtable_human_id;
  const autoFromParts = [person.first_name, person.last_name].filter(Boolean).join(" ");
  // Only pre-fill the override box when the current display_name isn't just
  // "First Last" — i.e. it really was a deliberate override, not the
  // ordinary derived value. Otherwise it stays blank with the auto-name
  // placeholder, same as a never-edited person.
  const displayIsOverride = Boolean(person.display_name) && person.display_name !== autoFromParts;

  const startEditingName = () => {
    setNameForm({
      first: person.first_name ?? "",
      last: person.last_name ?? "",
      nickname: person.nickname ?? "",
      organization: person.organization ?? "",
      display: displayIsOverride ? (person.display_name ?? "") : "",
    });
    setEditingName(true);
  };

  const handleSaveName = async () => {
    setSaving(true);
    try {
      // This is a full-form save of a known person's current values, so
      // first_name/last_name/nickname/organization are sent as-is (even
      // when empty) — an explicitly blanked field really does clear it.
      // display_name keeps the "blank = no override, derive automatically"
      // convention from the Add Contact flow.
      await renamePerson({
        personId: person._id,
        display_name: nameForm.display.trim() || undefined,
        first_name: nameForm.first.trim(),
        last_name: nameForm.last.trim(),
        nickname: nameForm.nickname.trim(),
        organization: nameForm.organization.trim(),
      });
      setEditingName(false);
      void api.refreshIdentity().catch(() => undefined);
    } catch {
      showToast("Failed to save name");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.avatarWrap}>
          <PersonAvatar address={address} name={person.display_name ?? address} size={96} />
        </View>
        {editingName ? (
          <View style={styles.editNameBlock}>
            <NameFormFields
              value={nameForm}
              onChange={(patch) => setNameForm((f) => ({ ...f, ...patch }))}
              theme={theme}
              autoFocusFirst
            />
            <View style={styles.editNameActions}>
              <Pressable
                disabled={saving}
                hitSlop={8}
                accessibilityLabel="Cancel"
                style={styles.editNameActionBtn}
                onPress={() => setEditingName(false)}
              >
                <Ionicons name="close" size={18} color={theme.textSecondary} />
                <Text style={{ color: theme.textSecondary, fontSize: 15 }}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={saving}
                hitSlop={8}
                accessibilityLabel="Save name"
                style={styles.editNameActionBtn}
                onPress={handleSaveName}
              >
                {saving ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={theme.accent} />
                    <Text style={{ color: theme.accent, fontSize: 15, fontWeight: "600" }}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Pressable style={styles.titleRow} onPress={startEditingName}>
              <Text style={[styles.title, { color: theme.text }]}>{person.display_name ?? address}</Text>
              <Ionicons name="pencil" size={14} color={theme.textSecondary} />
            </Pressable>
            {person.organization && (
              <Text style={[styles.orgLine, { color: theme.textSecondary }]}>{person.organization}</Text>
            )}
          </>
        )}
        <Text style={[styles.statusLine, { color: theme.textSecondary }]}>
          {lastContactedAt ? `Last contacted ${formatListTimestamp(lastContactedAt)}` : "No conversation yet"}
        </Text>

        <View style={styles.actionRow}>
          <Pressable style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]} onPress={handleMessage}>
            <Ionicons name="chatbubble-ellipses" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>Message</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.backgroundElement, opacity: canCall ? 1 : 0.4 }]}
            disabled={!canCall}
            onPress={handleCall}
          >
            <Ionicons name="call" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>Call</Text>
          </Pressable>
        </View>

        <PersonNetworksList identities={identities} airtableId={airtableId} />
        <PersonConversationsList chats={sortedChats} onOpenChat={openChat} />

        {airtableId && (
          <Pressable style={styles.footerLink} onPress={() => Linking.openURL(airtableRecordUrl(airtableId))}>
            <Text style={{ color: theme.accent, fontSize: 14, fontWeight: "600" }}>View in Airtable</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The First/Last/Nickname/Organization/Display-override input stack, shared
 * by the "Add Contact" and "edit person" flows above — same fields, same
 * layout, different submit handler and initial values at each call site.
 */
function NameFormFields({
  value,
  onChange,
  theme,
  autoFocusFirst,
}: {
  value: NameFormState;
  onChange: (patch: Partial<NameFormState>) => void;
  theme: Theme;
  autoFocusFirst?: boolean;
}) {
  const inputStyle = [
    styles.nameInput,
    { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.divider },
  ];
  const autoDisplay = [value.first.trim(), value.last.trim()].filter(Boolean).join(" ");

  return (
    <View style={styles.nameFormWrap}>
      <View style={styles.nameFormRow}>
        <TextInput
          value={value.first}
          onChangeText={(t) => onChange({ first: t })}
          placeholder="First"
          placeholderTextColor={theme.textSecondary}
          autoFocus={autoFocusFirst}
          style={[...inputStyle, styles.nameInputHalf]}
        />
        <TextInput
          value={value.last}
          onChangeText={(t) => onChange({ last: t })}
          placeholder="Last"
          placeholderTextColor={theme.textSecondary}
          style={[...inputStyle, styles.nameInputHalf]}
        />
      </View>
      <TextInput
        value={value.nickname}
        onChangeText={(t) => onChange({ nickname: t })}
        placeholder="Nickname"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
      />
      <TextInput
        value={value.organization}
        onChangeText={(t) => onChange({ organization: t })}
        placeholder="Organization"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
      />
      <TextInput
        value={value.display}
        onChangeText={(t) => onChange({ display: t })}
        placeholder={autoDisplay ? `Auto: ${autoDisplay}` : "Display name"}
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 58,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderTitle: { fontSize: 16, fontWeight: "600" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 1, marginLeft: -4 },
  container: { flex: 1, alignItems: "center", padding: 24, paddingTop: 32 },
  avatarWrap: { marginBottom: 14 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  orgLine: { fontSize: 14, textAlign: "center", marginBottom: 4 },
  statusLine: { fontSize: 14, textAlign: "center", marginBottom: 4 },
  nameInput: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  nameFormWrap: { width: "100%" },
  nameFormRow: { flexDirection: "row", gap: Spacing.two },
  nameInputHalf: { flex: 1 },
  editNameBlock: { width: "100%", marginBottom: 4 },
  editNameActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.four,
    marginTop: -2,
  },
  editNameActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  addButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    width: "100%",
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  footerLink: {
    marginTop: 20,
    paddingVertical: 8,
  },
});
