import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  type EventLink,
  type Priority,
  useAddTag,
  useLinkEvent,
  useRemoveTag,
  useSetFavorite,
  useSetNotes,
  useSetPriority,
  useUnlinkEvent,
} from "@/lib/identity";
import { editedLine, eventTile, PRIORITY_OPTIONS, priorityFromOption, priorityOption } from "@/lib/crm-summary";
import { showToast } from "@/lib/toast";
import { useSignal } from "./contacts-theme";
import { Card, ContactsDropdown, ContactsSwitch, rowDivider, SectionHeader, TextAction } from "./contacts-ui";
import { CrmEventsEditor } from "./crm-events-editor";

export interface PersonRelationshipProps {
  readonly personId: string;
  readonly isFavorite: boolean;
  readonly priority: Priority | undefined;
  readonly tags: string[];
  readonly events: EventLink[];
  readonly notes: string | undefined;
  readonly notesUpdatedAt: string | undefined;
  /** Phone: each block sits in an inset grouped card. */
  readonly grouped: boolean;
}

/** The relationship column: Favorite, Priority, Tags, Notes and Linked events. */
export function PersonRelationship({ personId, isFavorite, priority, tags, events, notes, notesUpdatedAt, grouped }: PersonRelationshipProps) {
  const colors = useSignal();
  const setFavorite = useSetFavorite();
  const setPriority = useSetPriority();
  const fail = (what: string) => () => showToast(`Couldn't ${what}. Try again.`);

  const favoriteRow = (
    <View style={[styles.lr, grouped && styles.lrGrouped]}>
      <View style={styles.k}>
        {grouped ? null : <Ionicons name="star-outline" size={15} color={colors.icon} />}
        <Text style={[grouped ? styles.kGrouped : styles.kText, { color: grouped ? colors.text : colors.textSecondary }]}>Favorite</Text>
      </View>
      <ContactsSwitch
        label="Favorite"
        value={isFavorite}
        onChange={(next) => void setFavorite({ personId, is_favorite: next }).catch(fail("update the favorite"))}
      />
    </View>
  );
  const priorityRow = (
    <View style={[styles.lr, grouped && styles.lrGrouped, rowDivider(colors, false)]}>
      <View style={styles.k}>
        {grouped ? null : <Ionicons name="information-circle-outline" size={15} color={colors.icon} />}
        <Text style={[grouped ? styles.kGrouped : styles.kText, { color: grouped ? colors.text : colors.textSecondary }]}>Priority</Text>
      </View>
      <ContactsDropdown
        label="Priority"
        value={priorityOption(priority)}
        options={PRIORITY_OPTIONS}
        onChange={(value) => void setPriority({ personId, priority: priorityFromOption(value) }).catch(fail("update the priority"))}
        style={styles.priority}
      />
    </View>
  );

  return (
    <View style={styles.column}>
      <View>
        <SectionHeader title="Relationship" />
        {grouped ? (
          <Card>
            {favoriteRow}
            {priorityRow}
            <View style={[styles.tagsGrouped, rowDivider(colors, false)]}><TagChips personId={personId} tags={tags} /></View>
          </Card>
        ) : (
          <>
            {favoriteRow}
            {priorityRow}
          </>
        )}
      </View>
      {grouped ? null : (
        <View>
          <SectionHeader title="Tags" />
          <TagChips personId={personId} tags={tags} />
        </View>
      )}
      <NotesBlock personId={personId} notes={notes} updatedAt={notesUpdatedAt} />
      <LinkedEvents personId={personId} events={events} grouped={grouped} />
    </View>
  );
}

function TagChips({ personId, tags }: { readonly personId: string; readonly tags: string[] }) {
  const colors = useSignal();
  const addTag = useAddTag();
  const removeTag = useRemoveTag();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const submit = () => {
    const tag = draft.trim();
    setAdding(false);
    setDraft("");
    if (tag) void addTag({ personId, tag }).catch(() => showToast("Couldn't add the tag. Try again."));
  };
  return (
    <View style={styles.tags}>
      {tags.map((tag) => (
        <Pressable
          key={tag}
          accessibilityRole="button"
          accessibilityLabel={`Remove tag ${tag}`}
          onPress={() => void removeTag({ personId, tag }).catch(() => showToast("Couldn't remove the tag. Try again."))}
          style={({ hovered }: { hovered?: boolean }) => [styles.tag, { backgroundColor: hovered ? colors.rowSelected : colors.field }]}
        >
          {({ hovered }: { hovered?: boolean }) => (
            <>
              <Text style={[styles.tagText, { color: colors.textSecondary }]}>{tag[0].toUpperCase() + tag.slice(1)}</Text>
              {hovered ? <Ionicons name="close" size={11} color={colors.textSecondary} /> : null}
            </>
          )}
        </Pressable>
      ))}
      {adding ? (
        <TextInput
          autoFocus
          accessibilityLabel="New tag"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          onBlur={submit}
          placeholder="Tag"
          placeholderTextColor={colors.textTertiary}
          style={[styles.tag, styles.tagInput, { borderColor: colors.focusRing, color: colors.text }]}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add tag"
          onPress={() => setAdding(true)}
          style={({ hovered }: { hovered?: boolean }) => [styles.tag, styles.tagAdd, { borderColor: colors.dividerStrong }, hovered && { backgroundColor: colors.rowHover }]}
        >
          <Ionicons name="add" size={13} color={colors.textSecondary} />
          <Text style={[styles.tagText, { color: colors.textSecondary }]}>Tag</Text>
        </Pressable>
      )}
    </View>
  );
}

function NotesBlock({ personId, notes, updatedAt }: { readonly personId: string; readonly notes: string | undefined; readonly updatedAt: string | undefined }) {
  const colors = useSignal();
  const setNotes = useSetNotes();
  const [draft, setDraft] = useState(notes ?? "");
  useEffect(() => setDraft(notes ?? ""), [notes]);
  const save = () => {
    if (draft.trim() === (notes ?? "").trim()) return;
    void setNotes({ personId, notes: draft }).catch(() => showToast("Couldn't save the notes. Try again."));
  };
  return (
    <View>
      <SectionHeader title="Notes" />
      <Card style={styles.notes}>
        <TextInput
          accessibilityLabel="Notes"
          multiline
          value={draft}
          onChangeText={setDraft}
          onBlur={save}
          placeholder="Add a note"
          placeholderTextColor={colors.textTertiary}
          style={[styles.notesInput, { color: colors.text }, { outlineStyle: "none" } as object]}
        />
        {updatedAt && notes ? <Text style={[styles.edited, { color: colors.textTertiary }]}>{editedLine(updatedAt)}</Text> : null}
      </Card>
    </View>
  );
}

function LinkedEvents({ personId, events, grouped }: { readonly personId: string; readonly events: EventLink[]; readonly grouped: boolean }) {
  const colors = useSignal();
  const linkEvent = useLinkEvent();
  const unlinkEvent = useUnlinkEvent();
  const [linking, setLinking] = useState(false);
  const rows = events.map((e, i) => {
    const tile = eventTile(e.start_date);
    return (
      <Pressable
        key={e.linkId}
        accessibilityRole="button"
        accessibilityLabel={`${e.name}${tile ? `, ${tile.long}` : ""}. Unlink`}
        onLongPress={() => void unlinkEvent({ linkId: e.linkId }).catch(() => showToast("Couldn't unlink the event. Try again."))}
        style={[grouped ? styles.evGrouped : styles.ev, rowDivider(colors, i === 0)]}
      >
        {grouped ? (
          <>
            {tile ? <Text style={[styles.evWhen, { color: colors.textSecondary }]}>{tile.long}</Text> : null}
            <Text style={[styles.evNameGrouped, { color: colors.text }]}>{e.name}</Text>
          </>
        ) : (
          <>
            <View style={[styles.tile, { borderColor: colors.dividerStrong }]}>
              <Text style={[styles.tileDay, { color: colors.text }]}>{tile?.day ?? "–"}</Text>
              <Text style={[styles.tileMonth, { color: colors.textSecondary }]}>{tile?.month ?? ""}</Text>
            </View>
            <View style={styles.evText}>
              <Text numberOfLines={1} style={[styles.evName, { color: colors.text }]}>{e.name}</Text>
              {tile?.time ? <Text style={[styles.evTime, { color: colors.textSecondary }]}>{tile.time}</Text> : null}
            </View>
          </>
        )}
      </Pressable>
    );
  });
  return (
    <View>
      <SectionHeader title="Linked events" trailing={<TextAction label={linking ? "Done" : "Link event"} onPress={() => setLinking((v) => !v)} />} />
      {grouped && rows.length > 0 ? <Card>{rows}</Card> : rows}
      {linking ? (
        <View style={styles.linker}>
          <CrmEventsEditor
            events={[]}
            onLink={async (record) => {
              await linkEvent({ personId, airtable_event_id: record.record_id, event_name: record.name, start_date: record.start_date });
              setLinking(false);
            }}
            onUnlink={() => undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 22 },
  lr: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44 },
  lrGrouped: { minHeight: 52, paddingHorizontal: 14 },
  k: { alignItems: "center", flexDirection: "row", gap: 8 },
  kText: { fontSize: 12.5 },
  kGrouped: { fontSize: 16 },
  priority: { minWidth: 150 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagsGrouped: { paddingHorizontal: 14, paddingVertical: 12 },
  tag: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 4, height: 26, paddingHorizontal: 11 },
  tagText: { fontSize: 12.5, fontWeight: "500" },
  tagAdd: { backgroundColor: "transparent", borderWidth: 1 },
  tagInput: { borderWidth: 1.5, fontSize: 12.5, minWidth: 80, paddingVertical: 0 },
  notes: { paddingHorizontal: 12, paddingVertical: 10 },
  notesInput: { fontSize: 13, lineHeight: 19, minHeight: 40, padding: 0 },
  edited: { fontSize: 11.5, marginTop: 6 },
  ev: { alignItems: "center", flexDirection: "row", gap: 12, paddingVertical: 8 },
  evGrouped: { paddingHorizontal: 14, paddingVertical: 10 },
  evWhen: { fontSize: 13 },
  evNameGrouped: { fontSize: 16, marginTop: 2 },
  tile: { alignItems: "center", borderRadius: 8, borderWidth: 1, paddingVertical: 4, width: 44 },
  tileDay: { fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "600", lineHeight: 17 },
  tileMonth: { fontSize: 10.5 },
  evText: { flex: 1, minWidth: 0 },
  evName: { fontSize: 12.5, fontWeight: "600" },
  evTime: { fontSize: 12, marginTop: 2 },
  linker: { marginTop: 8 },
});
